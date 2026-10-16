import { TOKEN_A, TOKEN_B } from './helpers/lock-fixture.ts';
import { createLeaseSidecar, leaseMtimeMs, touchLeaseSidecar } from '../src/lock-sidecar.ts';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { mkdir, mkdtemp, open, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, utimes: vi.fn<typeof actual.utimes>(actual.utimes) };
});

const OLD_TIME = new Date('2000-01-01T00:00:00Z');
const makeLock = async (): Promise<string> => {
  const home = await mkdtemp(join(tmpdir(), 'refs-sidecar-'));
  onTestFinished(() => rm(home, { force: true, recursive: true }));
  const lock = join(home, 'lock');
  await mkdir(lock);
  return lock;
};
const seedSidecar = async (lock: string, token: string): Promise<string> => {
  await createLeaseSidecar(lock, token);
  const path = join(lock, `lease-${token}`);
  await utimes(path, OLD_TIME, OLD_TIME);
  return path;
};

// Observe the timestamp and bytes through one descriptor, so both assertions describe the
// same file even if its pathname is replaced between filesystem operations.
const readSidecar = async (path: string) => {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    return { contents: await file.readFile('utf8'), mtimeMs: info.mtimeMs };
  } finally {
    await file.close();
  }
};

describe('lease sidecar filesystem boundaries', () => {
  it.each(['not-a-uuid', 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE', `${TOKEN_A}x`])(
    'does not read a sidecar named by invalid external token %s',
    async (token) => {
      expect.hasAssertions();
      const lock = await makeLock();
      await writeFile(join(lock, `lease-${token}`), 'untrusted');
      await expect(leaseMtimeMs(lock, token)).resolves.toStrictEqual({ state: 'absent' });
    },
  );

  it('rejects a token that would escape its lock directory before looking up the file', async () => {
    expect.hasAssertions();
    const lock = await makeLock();
    const outside = join(lock, '..', 'outside');
    await writeFile(outside, 'keep');
    await expect(leaseMtimeMs(lock, `${TOKEN_A}/../../outside`)).resolves.toStrictEqual({
      state: 'absent',
    });
    await expect(readFile(outside, 'utf8')).resolves.toBe('keep');
  });
});

describe('lease sidecar renewal', () => {
  it('renews the actual timestamp without changing sidecar contents', async () => {
    expect.hasAssertions();
    const lock = await makeLock();
    const path = await seedSidecar(lock, TOKEN_A);
    await expect(touchLeaseSidecar(lock, TOKEN_A)).resolves.toBe('renewed');
    const info = await readSidecar(path);
    expect(info.mtimeMs).toBeGreaterThan(OLD_TIME.getTime());
    expect(info.contents).toBe('');
  });

  it('never creates a missing sidecar or renews a successor acquisition', async () => {
    expect.hasAssertions();
    const lock = await makeLock();
    const successor = await seedSidecar(lock, TOKEN_B);
    await expect(touchLeaseSidecar(lock, TOKEN_A)).resolves.toBe('gone');
    await expect(stat(join(lock, `lease-${TOKEN_A}`))).rejects.toMatchObject({ code: 'ENOENT' });
    const info = await stat(successor);
    expect(info.mtimeMs).toBe(OLD_TIME.getTime());
  });

  it('propagates a renewal I/O failure and permits a later successful retry', async () => {
    expect.hasAssertions();
    const lock = await makeLock();
    await seedSidecar(lock, TOKEN_A);
    const error = Object.assign(new Error('renewal denied'), { code: 'EACCES' });
    vi.mocked(utimes).mockRejectedValueOnce(error);
    await expect(touchLeaseSidecar(lock, TOKEN_A)).rejects.toBe(error);
    await expect(touchLeaseSidecar(lock, TOKEN_A)).resolves.toBe('renewed');
  });
});
