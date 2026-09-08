import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { SpawnRunner } from '../../src/proc/runner.ts';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { packagesBefore } from '../../src/git/arrivals.ts';
import { tmpdir } from 'node:os';

// The declaration changes that do NOT invalidate the before-picture — an ordinary root commit, a
// widening edit, a second declaration file appearing. Split from `declarations.test.ts` for the
// 300-line cap.
//
// `packagesBefore` reconstructs the previous names partly from members the range did not touch,
// on the grounds that their manifests are byte-identical at both ends. That holds only while the
// caller can still see those members. Dropping a directory from `workspaces` removes a package
// from the scan without touching its manifest, so its name survives in neither source — and a new
// directory carrying that same name would be announced as an arrival it is not.

const runner = new SpawnRunner();

const git = (dir: string, ...args: string[]): void => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
};

const write = (dir: string, relative: string, contents: unknown): void => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(join(dir, relative, '..'), { recursive: true });
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(
    join(dir, relative),
    typeof contents === 'string' ? contents : JSON.stringify(contents),
  );
};

const commitAll = (dir: string, message: string): string => {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', message);
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
};

/** A repo declaring `packages/a` and `packages/b` explicitly, so the declaration can be edited
 * without touching any package manifest. */
const declaredRepo = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-declarations-'));
  git(dir, 'init', '-q', '.');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  write(dir, 'packages/a/package.json', { name: '@x/a', version: '1.0.0' });
  write(dir, 'packages/b/package.json', { name: '@x/b', version: '1.0.0' });
  write(dir, 'package.json', {
    name: 'root',
    version: '1.0.0',
    workspaces: ['packages/a', 'packages/b'],
  });
  return dir;
};

describe('a range that changed the root manifest without changing the declaration', () => {
  it(
    'still reports the before-picture, so an ordinary root commit is not silencing',
    async () => {
      expect.hasAssertions();
      const dir = await declaredRepo();
      const from = commitAll(dir, 'one');
      // A version bump. Root manifests change constantly; treating every such commit as a
      // membership change would silence arrivals in most repositories.
      write(dir, 'package.json', {
        name: 'root',
        version: '2.0.0',
        workspaces: ['packages/a', 'packages/b'],
      });
      const to = commitAll(dir, 'bump');

      await expect(packagesBefore(runner, { dir, from, to })).resolves.toStrictEqual({
        changedDirs: [],
        namesBefore: ['root'],
      });
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'gives up on a reordering, which the same set can hide',
    async () => {
      expect.hasAssertions();
      const dir = await declaredRepo();
      const from = commitAll(dir, 'one');
      write(dir, 'package.json', {
        name: 'root',
        version: '1.0.0',
        workspaces: ['packages/b', 'packages/a'],
      });
      write(dir, 'packages/new/package.json', { name: '@x/new', version: '1.0.0' });
      const to = commitAll(dir, 'reorder');

      // This test used to assert the opposite, on the reasoning that order does not change which
      // directories are selected. It does: `["packages/*", "!b", "b"]` and
      // `["packages/*", "b", "!b"]` are the same SET and different memberships, so a reorder can
      // drop a member with its manifest untouched — and its name then survives in neither source.
      await expect(packagesBefore(runner, { dir, from, to })).resolves.toBeUndefined();
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('a declaration pattern inserted where it belongs', () => {
  it(
    'is not a narrowing, which is how repositories actually add one',
    async () => {
      expect.hasAssertions();
      const dir = await declaredRepo();
      write(dir, 'pnpm-workspace.yaml', 'packages:\n  - packages/a\n  - packages/z\n');
      const from = commitAll(dir, 'one');
      // TanStack Query's own commit adding `packages/lit-query` inserts `examples/lit/*` between
      // `examples/preact/*` and `examples/solid/*`. Requiring an APPEND made that commit look like
      // a narrowing and silenced every finding about it — the exact case this reconstruction
      // exists to report, found by running the real repository rather than by a review.
      write(
        dir,
        'pnpm-workspace.yaml',
        'packages:\n  - packages/a\n  - packages/inserted\n  - packages/z\n',
      );
      write(dir, 'packages/inserted/package.json', { name: '@x/inserted', version: '1.0.0' });
      const to = commitAll(dir, 'insert a pattern in the middle');

      await expect(packagesBefore(runner, { dir, from, to })).resolves.toStrictEqual({
        changedDirs: ['packages/inserted'],
        namesBefore: [],
      });
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
