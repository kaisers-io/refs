import { createLeaseSidecar, leaseMtimeMs, touchLeaseSidecar } from '../src/lock-sidecar.ts';
import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The lease sidecar in isolation. `lock-lease`/`lock-heartbeat` exercise it through the lock, where
// the token is always this process's own `randomUUID()`; what only shows up here is the token that
// comes off disk (path safety) and the three renewal outcomes, including the error that must NOT be
// read as "lock lost".

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, utimes: vi.fn<typeof actual.utimes>(actual.utimes) };
});

const TOKEN = '11111111-2222-4333-8444-555555555555';
const AN_HOUR_AGO_MS = 3_600_000;

const lockDir = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'refs-sidecar-'));
  const lockPath = join(root, 'locks', 'home');
  await mkdir(lockPath, { recursive: true });
  return lockPath;
};

describe('a token read off disk that is not a randomUUID', () => {
  it.each(['../escape', 'lease/../../x', '', `${TOKEN}\n`, 'AAAAAAAA-2222-4333-8444-555555555555'])(
    'names no sidecar for %j, even where a file would resolve',
    async (token) => {
      expect.hasAssertions();
      const lockPath = await lockDir();
      // What `join(lockPath, 'lease-' + token)` would reach for the traversal tokens.
      await mkdir(join(lockPath, 'lease-..'), { recursive: true });
      await mkdir(join(lockPath, 'lease-lease'), { recursive: true });
      await writeFile(join(lockPath, 'escape'), '');
      await writeFile(join(lockPath, '..', 'x'), '');
      await expect(leaseMtimeMs(lockPath, token)).resolves.toStrictEqual({ state: 'absent' });
      await expect(touchLeaseSidecar(lockPath, token)).resolves.toBe('gone');
    },
  );
});

describe('renewing a lease', () => {
  it('moves the mtime forward when the sidecar is there', async () => {
    expect.hasAssertions();
    const lockPath = await lockDir();
    await createLeaseSidecar(lockPath, TOKEN);
    const old = new Date(Date.now() - AN_HOUR_AGO_MS);
    const sidecar = join(lockPath, `lease-${TOKEN}`);
    await utimes(sidecar, old, old);
    await expect(touchLeaseSidecar(lockPath, TOKEN)).resolves.toBe('renewed');
    const after = await stat(sidecar);
    expect(after.mtimeMs).toBeGreaterThan(old.getTime());
    await expect(leaseMtimeMs(lockPath, TOKEN)).resolves.toStrictEqual({
      mtimeMs: after.mtimeMs,
      state: 'ok',
    });
  });

  it('reports a missing sidecar as gone and never creates one', async () => {
    expect.hasAssertions();
    const lockPath = await lockDir();
    await expect(touchLeaseSidecar(lockPath, TOKEN)).resolves.toBe('gone');
    await expect(readdir(lockPath)).resolves.toStrictEqual([]);
  });

  it('lets any other error through instead of calling the lock lost', async () => {
    expect.hasAssertions();
    const lockPath = await lockDir();
    await createLeaseSidecar(lockPath, TOKEN);
    const denied = Object.assign(new Error('EPERM: injected'), { code: 'EPERM' });
    vi.mocked(utimes).mockRejectedValueOnce(denied);
    await expect(touchLeaseSidecar(lockPath, TOKEN)).rejects.toBe(denied);
    await expect(stat(join(lockPath, `lease-${TOKEN}`))).resolves.toBeDefined();
  });
});
