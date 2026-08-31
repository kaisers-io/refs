import {
  DEAD_PID,
  TOKEN_A,
  TOKEN_B,
  makeHome,
  writeLeaseSidecar,
  writeLockDir,
} from './helpers/lock-fixture.ts';
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { inspectLocks } from '../src/lock-inspect.ts';
import { join } from 'node:path';

// `inspectLocks` is what `refs doctor` sees. Its verdicts come from the same `diagnoseLock` a
// waiter uses, so these cases double as the readable statement of that policy: which clock applies,
// and what liveness is allowed to claim.

const OLD_ACQUISITION_MS = 660_000;
const EXPIRED_LEASE_MS = 180_000;
const FRESH_MS = 0;
const BETWEEN_POLICIES_MS = 180_000;
// Pids that are not pids: `0` selects the caller's process group, a negative value selects a group
// or every process, and a fraction is not a pid at all.
const GROUP_PID = 0;
const NEGATIVE_PID = -1;
const FRACTIONAL_PID = 1.5;

const nowMinus = (ms: number): string => new Date(Date.now() - ms).toISOString();

const seedLock = (locksDir: string, name: string, meta: object): string =>
  writeLockDir(locksDir, name, meta);

describe('inspectLocks empty cases', () => {
  it('reports nothing when the locks directory does not exist', async () => {
    expect.hasAssertions();
    const home = makeHome();

    await expect(inspectLocks(home)).resolves.toStrictEqual([]);
  });

  it('ignores steal claims and tombstones, which are not held locks', async () => {
    expect.hasAssertions();
    const home = makeHome();
    // Both are normal, short-lived protocol artifacts. Reporting them would make the check flap on
    // healthy concurrent activity — a claim exists for a couple of filesystem operations.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(home.locksDir, 'home.steal-claim'), { recursive: true });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(home.locksDir, 'home.steal.11111111-2222-4333-8444-555555555555'), {
      recursive: true,
    });

    await expect(inspectLocks(home)).resolves.toStrictEqual([]);
  });
});

describe('inspectLocks lease policy', () => {
  it('calls a long-held lock healthy while its lease is fresh', async () => {
    expect.hasAssertions();
    const home = makeHome();
    // Eleven minutes since acquisition, renewed just now: the acquisition age is irrelevant, which
    // is the whole point of the lease. A long clone must not read as a problem.
    const lockPath = seedLock(home.locksDir, 'home', {
      acquired_at: nowMinus(OLD_ACQUISITION_MS),
      pid: process.pid,
      token: TOKEN_A,
    });
    writeLeaseSidecar(lockPath, TOKEN_A, FRESH_MS);

    const [lock] = await inspectLocks(home);

    expect(lock?.diagnosis).toMatchObject({ policy: 'lease', stale: false });
  });
});

describe('inspectLocks expired lease', () => {
  it('marks a live holder stale once its lease has expired', async () => {
    expect.hasAssertions();
    const home = makeHome();
    const lockPath = seedLock(home.locksDir, 'home', {
      acquired_at: nowMinus(FRESH_MS),
      pid: process.pid,
      token: TOKEN_A,
    });
    writeLeaseSidecar(lockPath, TOKEN_A, EXPIRED_LEASE_MS);

    const [lock] = await inspectLocks(home);

    expect(lock?.diagnosis).toMatchObject({
      pidState: 'present-or-unknown',
      policy: 'lease',
      stale: true,
    });
  });
});

describe('inspectLocks legacy fallback', () => {
  it('falls back to the legacy window when no sidecar matches the acquisition', async () => {
    expect.hasAssertions();
    const home = makeHome();
    // A sidecar exists, but for a different acquisition — the shape a delayed renewal from an
    // already-stolen holder would leave. It must not extend this lock's lease.
    const lockPath = seedLock(home.locksDir, 'home', {
      acquired_at: nowMinus(BETWEEN_POLICIES_MS),
      pid: process.pid,
      token: TOKEN_A,
    });
    writeLeaseSidecar(lockPath, TOKEN_B, FRESH_MS);

    const [lock] = await inspectLocks(home);

    // Three minutes is past the lease but inside the legacy window, so not stale — and reported
    // under the policy that actually applies.
    expect(lock?.diagnosis).toMatchObject({ policy: 'legacy', stale: false });
  });
});

describe('inspectLocks liveness', () => {
  it('reports a recorded pid that is definitely gone, and calls it reclaimable', async () => {
    expect.hasAssertions();
    const home = makeHome();
    const lockPath = seedLock(home.locksDir, 'home', {
      acquired_at: nowMinus(FRESH_MS),
      pid: DEAD_PID,
      token: TOKEN_A,
    });
    writeLeaseSidecar(lockPath, TOKEN_A, FRESH_MS);

    const [lock] = await inspectLocks(home);

    // A fresh lease does not keep a dead process's lock alive: there is nothing left to wait out.
    expect(lock?.diagnosis).toMatchObject({ pidState: 'definitely-dead', stale: true });
  });
});

describe('inspectLocks malformed metadata', () => {
  it.each([
    ['a pid of zero, which selects a process GROUP rather than a process', GROUP_PID],
    ['a negative pid, which selects every process', NEGATIVE_PID],
    ['a fractional pid', FRACTIONAL_PID],
  ])('rejects %s as malformed rather than probing it', async (_label, pid) => {
    expect.hasAssertions();
    const home = makeHome();
    // `process.kill(0, 0)` answers for a whole process group, so an unvalidated pid here would
    // report "alive" for a lock whose real owner is long gone and keep it unreclaimable.
    seedLock(home.locksDir, 'home', { acquired_at: nowMinus(FRESH_MS), pid, token: TOKEN_A });

    const [lock] = await inspectLocks(home);

    expect(lock?.diagnosis).toMatchObject({ meta: 'malformed', pidState: 'unknown' });
  });

  it('distinguishes unparseable metadata from metadata that has not landed yet', async () => {
    expect.hasAssertions();
    const home = makeHome();
    const lockPath = join(home.locksDir, 'home');
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(lockPath, { recursive: true });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(lockPath, 'meta.json'), '{ not json');

    const [lock] = await inspectLocks(home);

    // Metadata is published atomically, so a torn write is not a normal state — malformed means
    // something is genuinely wrong, unlike a missing file during the publication grace.
    expect(lock?.diagnosis).toMatchObject({ meta: 'malformed', policy: 'grace' });
  });
});

describe('inspectLocks anomalous entries', () => {
  it('names a non-directory occupying a lock name', async () => {
    expect.hasAssertions();
    const home = makeHome();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(home.locksDir, { recursive: true });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(home.locksDir, 'home'), '');

    const [lock] = await inspectLocks(home);

    // It has no holder and no metadata, but exclusive `mkdir` fails against it just the same, so an
    // acquisition waits out its whole timeout against something that will never be released.
    expect(lock).toStrictEqual({ entry: 'blocking-entry', name: 'home' });
  });

  it('sorts entries by name, since directory order is unspecified', async () => {
    expect.hasAssertions();
    const home = makeHome();
    for (const name of ['ref.b', 'home', 'ref.a']) {
      seedLock(home.locksDir, name, {
        acquired_at: nowMinus(FRESH_MS),
        pid: process.pid,
        token: TOKEN_A,
      });
    }

    const locks = await inspectLocks(home);

    expect(locks.map((lock) => lock.name)).toStrictEqual(['home', 'ref.a', 'ref.b']);
  });
});
