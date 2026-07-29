import { describe, expect, it } from 'vitest';
import { dirMtimeMs, isPidAlive, readLockMeta, readLockToken } from '../src/lock-meta.ts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

// Parse/probe primitives behind the stale-lock decision (`lock.ts#isLockStale`): every malformed
// meta.json shape must collapse to the safe `undefined` sentinel (→ the conservative mtime-grace
// bucket), never throw and never yield a half-parsed meta that could justify stealing a lock that
// is actually held.

const withLockDir = async (
  metaContent: string | undefined,
  exercise: (lockPath: string) => Promise<void>,
): Promise<void> => {
  const lockPath = await mkdtemp(join(tmpdir(), 'refs-lock-meta-'));
  try {
    if (metaContent !== undefined) {
      await writeFile(join(lockPath, 'meta.json'), metaContent, 'utf8');
    }
    await exercise(lockPath);
  } finally {
    await rm(lockPath, { force: true, recursive: true });
  }
};

const VALID_META = JSON.stringify({
  acquired_at: '2026-07-29T00:00:00.000Z',
  pid: 12_345,
  token: 'tok-1',
});

describe('readLockMeta parse edges', () => {
  it.each([
    ['missing file', undefined],
    ['unparseable json', '{nope'],
    ['non-object json', '42'],
    ['missing pid', JSON.stringify({ acquired_at: '2026-07-29T00:00:00.000Z' })],
    ['non-numeric pid', JSON.stringify({ acquired_at: '2026-07-29T00:00:00.000Z', pid: 'x' })],
    ['missing acquired_at', JSON.stringify({ pid: 1 })],
    ['non-string acquired_at', JSON.stringify({ acquired_at: 123, pid: 1 })],
    ['unparseable acquired_at', JSON.stringify({ acquired_at: 'not-a-date', pid: 1 })],
  ])('collapses %s to undefined', async (_label, content) => {
    expect.hasAssertions();
    await withLockDir(content, async (lockPath) => {
      await expect(readLockMeta(lockPath)).resolves.toBeUndefined();
    });
  });

  it('parses a well-formed meta into pid + epoch millis', async () => {
    expect.hasAssertions();
    await withLockDir(VALID_META, async (lockPath) => {
      await expect(readLockMeta(lockPath)).resolves.toStrictEqual({
        acquiredAtMs: Date.parse('2026-07-29T00:00:00.000Z'),
        pid: 12_345,
      });
    });
  });
});

describe('readLockToken parse edges', () => {
  it.each([
    ['missing file', undefined],
    ['non-object json', '"just a string"'],
    ['missing token', JSON.stringify({ pid: 1 })],
    ['non-string token', JSON.stringify({ token: 7 })],
  ])('collapses %s to undefined', async (_label, content) => {
    expect.hasAssertions();
    await withLockDir(content, async (lockPath) => {
      await expect(readLockToken(lockPath)).resolves.toBeUndefined();
    });
  });

  it('extracts the ownership token from a well-formed meta', async () => {
    expect.hasAssertions();
    await withLockDir(VALID_META, async (lockPath) => {
      await expect(readLockToken(lockPath)).resolves.toBe('tok-1');
    });
  });
});

describe('dir mtime probe', () => {
  it('reports a real directory’s mtime and undefined for a missing path', async () => {
    expect.hasAssertions();
    await withLockDir(undefined, async (lockPath) => {
      await expect(dirMtimeMs(lockPath)).resolves.toBeTypeOf('number');
      await expect(dirMtimeMs(join(lockPath, 'nope'))).resolves.toBeUndefined();
    });
  });
});

/** Spawns a trivial child and waits for it to exit, yielding a pid that is KNOWN to be dead. */
const exitedChildPid = async (): Promise<number> => {
  const child = spawn(process.execPath, ['--version'], { stdio: 'ignore' });
  const { pid } = child;
  if (pid === undefined) {
    throw new Error('test setup: child failed to spawn');
  }
  await once(child, 'exit');
  return pid;
};

describe('isPidAlive probe outcomes', () => {
  it('reports this very process as alive', () => {
    expect.hasAssertions();
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('reports an exited process as dead (ESRCH)', async () => {
    expect.hasAssertions();
    const deadPid = await exitedChildPid();
    expect(isPidAlive(deadPid)).toBe(false);
  });
});
