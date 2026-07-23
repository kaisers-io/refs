// Genuine behavioral test: builds a real temp git repo (no mocking of git) and runs
// measureSearchBurden / measureRangeBurden against it, so the counts asserted here are
// exactly what a real `git grep` / `git log` / `git diff` invocation produces.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { measureRangeBurden, measureSearchBurden } from '../pilot/lib/burden.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnExec } from '../pilot/lib/exec.mjs';
import { tmpdir } from 'node:os';

const OK_EXIT = 0;
const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;

const git = async (dir, args) => {
  const { code, stderr, stdout } = await spawnExec('git', ['-C', dir, ...args], {});
  if (code !== OK_EXIT) {
    throw new Error(`fixture git ${args.join(' ')} failed (${code}): ${stderr}`);
  }
  return stdout;
};

const initFixtureGit = async (dir) => {
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'fixture@example.com']);
  await git(dir, ['config', 'user.name', 'Fixture']);
};

const commitAll = async (dir, message) => {
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', message]);
};

// Two tagged commits: v1 seeds "hello" matches in two files; v2 adds a third file with
// another "hello" match plus an unrelated file, so v1..v2 has a known commit/file/line delta.
const buildFixtureRepo = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'burden-fixture-'));
  await initFixtureGit(dir);
  await Promise.all([
    writeFile(join(dir, 'a.txt'), 'hello world\nfoo bar\n'),
    writeFile(join(dir, 'b.txt'), 'hello again\n'),
  ]);
  await commitAll(dir, 'first');
  await git(dir, ['tag', 'v1']);
  await Promise.all([
    writeFile(join(dir, 'c.txt'), 'hello once more\n'),
    writeFile(join(dir, 'd.txt'), 'unrelated content\n'),
  ]);
  await commitAll(dir, 'second');
  await git(dir, ['tag', 'v2']);
  return dir;
};

describe('measureSearchBurden', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await buildFixtureRepo();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it('counts grep hits, distinct files, and output bytes for a known query', async () => {
    const result = await measureSearchBurden(dir, ['hello']);
    expect(result.grep_hits).toBe(THREE);
    expect(result.distinct_files).toBe(THREE);
    expect(result.output_bytes).toBeGreaterThan(ZERO);
  });

  it('treats zero matches as a valid result, not an error', async () => {
    const result = await measureSearchBurden(dir, ['zzz_no_such_token_zzz']);
    expect(result.grep_hits).toBe(ZERO);
    expect(result.distinct_files).toBe(ZERO);
    expect(result.output_bytes).toBe(ZERO);
  });
});

describe('measureRangeBurden', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await buildFixtureRepo();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it('measures commit count and changed paths between two tags', async () => {
    const result = await measureRangeBurden(dir, 'v1', 'v2');
    expect(result.commit_count).toBe(ONE);
    expect(result.changed_paths).toBe(TWO);
    expect(result.insertions).toBeGreaterThan(ZERO);
    expect(result.deletions).toBe(ZERO);
  });

  it('returns undefined (not a fabricated result) when a tag does not resolve', async () => {
    const result = await measureRangeBurden(dir, 'v1', 'does-not-exist');
    expect(result).toBeUndefined();
  });
});
