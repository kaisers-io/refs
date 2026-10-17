import { LEASE_MS, diagnoseLock, renewLease } from '../src/lock-lease.ts';
import {
  TOKEN_A,
  TOKEN_B,
  makeHome,
  writeLeaseSidecar,
  writeLockDir,
} from './helpers/lock-fixture.ts';
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { existsSync, statSync, symlinkSync, writeFileSync } from 'node:fs';

// `renewLease` is what the heartbeat calls on every tick, but its interval is long enough that no
// other suite ever reaches it: `lock-heartbeat.test.ts` drives the heartbeat with an injected
// `renew`. These cases run it against a real lock directory, because what it must and must not do
// to that directory is the whole contract — renew our own lease, never create one, and never read
// an I/O fault as lost ownership.

// Past the 2-minute lease, so a sidecar backdated by this much reads as expired until renewed.
const EXPIRED_LEASE_AGE_MS = 180_000;
// Past the legacy 10-minute window, which is what a lock without a usable sidecar is judged by.
const LEGACY_STALE_AGE_MS = 660_000;

const sidecarPath = (lockPath: string, token: string): string => join(lockPath, `lease-${token}`);

const liveLock = (token: string): string =>
  writeLockDir(makeHome().locksDir, 'home', {
    acquired_at: new Date().toISOString(),
    pid: process.pid,
    token,
  });

describe('renewLease on our own acquisition', () => {
  it('stamps the sidecar so an expired lease reads as fresh again', async () => {
    expect.hasAssertions();
    const lockPath = liveLock(TOKEN_A);
    writeLeaseSidecar(lockPath, TOKEN_A, EXPIRED_LEASE_AGE_MS);
    const before = await diagnoseLock(lockPath, Date.now());
    expect(before.ageMs).toBeGreaterThan(LEASE_MS);

    await expect(renewLease(lockPath, TOKEN_A)).resolves.toBe('renewed');

    const after = await diagnoseLock(lockPath, Date.now());
    expect(after).toMatchObject({ policy: 'lease', stale: false });
    expect(after.ageMs).toBeLessThan(LEASE_MS);
  });
});

describe('renewLease after losing the lock', () => {
  it('reports a successor acquisition as lost and leaves no sidecar of ours in its directory', async () => {
    expect.hasAssertions();
    const lockPath = liveLock(TOKEN_B);
    writeLeaseSidecar(lockPath, TOKEN_B, 0);

    await expect(renewLease(lockPath, TOKEN_A)).resolves.toBe('lost');

    // eslint-disable-next-line node/no-sync -- assertion on the fixture, sync is fine
    expect(existsSync(sidecarPath(lockPath, TOKEN_A))).toBe(false);
  });

  it('reports a missing sidecar as lost and never creates one', async () => {
    expect.hasAssertions();
    // Our token, but no sidecar: the directory a late renewal lands in after its own was removed.
    // Creating the file here would reclassify a legacy holder as a lease holder (`lock-sidecar.ts`).
    const lockPath = liveLock(TOKEN_A);

    await expect(renewLease(lockPath, TOKEN_A)).resolves.toBe('lost');

    // eslint-disable-next-line node/no-sync -- assertion on the fixture, sync is fine
    expect(existsSync(sidecarPath(lockPath, TOKEN_A))).toBe(false);
  });
});

// A symlink loop is a non-ENOENT failure any user can provoke, unlike EACCES, which root ignores.
// Windows is skipped: creating a symlink there needs a privilege the runner may not grant.
describe.skipIf(process.platform === 'win32')('renewLease on an unrenewable sidecar', () => {
  it('propagates a non-ENOENT error instead of reporting the lock lost', async () => {
    expect.hasAssertions();
    const lockPath = liveLock(TOKEN_A);
    const path = sidecarPath(lockPath, TOKEN_A);
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(path, path);

    await expect(renewLease(lockPath, TOKEN_A)).rejects.toMatchObject({ code: 'ELOOP' });
  });
});

describe('diagnoseLock on a token that is not a randomUUID', () => {
  it('judges the lock by the legacy window, never by a file the token points outside the lock', async () => {
    expect.hasAssertions();
    // `lease-/../../decoy` joined onto the lock path names `<locksDir>/decoy`. A fresh file sits
    // there, so if the token reached the filesystem this old lock would read as a renewed lease.
    const lockPath = writeLockDir(makeHome().locksDir, 'home', {
      acquired_at: new Date(Date.now() - LEGACY_STALE_AGE_MS).toISOString(),
      pid: process.pid,
      token: '/../../decoy',
    });
    const decoy = join(dirname(lockPath), 'decoy');
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(decoy, '');
    // eslint-disable-next-line node/no-sync -- confirms the decoy really is fresh
    expect(Date.now() - statSync(decoy).mtimeMs).toBeLessThan(LEASE_MS);

    const diagnosis = await diagnoseLock(lockPath, Date.now());

    expect(diagnosis).toMatchObject({ policy: 'legacy', stale: true });
  });
});
