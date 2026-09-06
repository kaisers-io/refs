import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { packagesBefore } from '../../src/git/arrivals.ts';
import { tmpdir } from 'node:os';

// What a workspace DECLARATION change does to the before-picture.
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

describe('a range that changed which directories are declared', () => {
  it(
    'gives up rather than reconstructing names it can no longer see',
    async () => {
      expect.hasAssertions();
      const dir = await declaredRepo();
      const from = commitAll(dir, 'one');
      // `packages/b` keeps its manifest and loses its declaration, while a new directory takes up
      // its name. Neither source remembers `@x/b`: not history, because that manifest is
      // unchanged; not the scan, because the package is no longer a member.
      write(dir, 'packages/c/package.json', { name: '@x/b', version: '2.0.0' });
      write(dir, 'package.json', {
        name: 'root',
        version: '1.0.0',
        workspaces: ['packages/a', 'packages/c'],
      });
      const to = commitAll(dir, 'redeclare');

      await expect(packagesBefore(runner, { dir, from, to })).resolves.toBeUndefined();
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'gives up when a pnpm workspace file loses a pattern',
    async () => {
      expect.hasAssertions();
      const dir = await declaredRepo();
      write(dir, 'pnpm-workspace.yaml', 'packages:\n  - packages/a\n  - tools/*\n');
      const from = commitAll(dir, 'one');
      write(dir, 'pnpm-workspace.yaml', 'packages:\n  - packages/a\n');
      const to = commitAll(dir, 'drop tools');

      // The pathspec covers this file for exactly this reason: it is not a manifest, so nothing
      // else in the range would reveal that membership narrowed.
      await expect(packagesBefore(runner, { dir, from, to })).resolves.toBeUndefined();
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('a declaration this reader cannot parse', () => {
  it(
    'counts as narrowing rather than as declaring nothing',
    async () => {
      expect.hasAssertions();
      const dir = await declaredRepo();
      // Flow style. `collectPnpmPatterns` reads block sequences only and returns `[]` — which, read
      // as "declared nothing", makes the old declaration a subset of everything and hides the
      // narrowing below it.
      write(dir, 'pnpm-workspace.yaml', 'packages: [packages/a, packages/b]\n');
      const from = commitAll(dir, 'one');
      write(dir, 'pnpm-workspace.yaml', 'packages:\n  - packages/a\n');
      write(dir, 'packages/new/package.json', { name: '@x/b', version: '2.0.0' });
      const to = commitAll(dir, 'narrow');

      await expect(packagesBefore(runner, { dir, from, to })).resolves.toBeUndefined();
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('a range that added a negation', () => {
  it(
    'counts as narrowing, because a negation removes members',
    async () => {
      expect.hasAssertions();
      const dir = await declaredRepo();
      write(dir, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
      const from = commitAll(dir, 'one');
      // Adding `!packages/b` takes that member out of the scan just as surely as deleting it from
      // an explicit list would, and its manifest is untouched — so its name is remembered by
      // neither source. Expansion is monotone in the INCLUSIVE patterns only.
      write(dir, 'pnpm-workspace.yaml', "packages:\n  - packages/*\n  - '!packages/b'\n");
      write(dir, 'packages/new/package.json', { name: '@x/b', version: '2.0.0' });
      const to = commitAll(dir, 'exclude b');

      await expect(packagesBefore(runner, { dir, from, to })).resolves.toBeUndefined();
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'is untroubled by a negation being REMOVED, which only widens',
    async () => {
      expect.hasAssertions();
      const dir = await declaredRepo();
      write(dir, 'pnpm-workspace.yaml', "packages:\n  - packages/*\n  - '!packages/b'\n");
      const from = commitAll(dir, 'one');
      write(dir, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
      write(dir, 'packages/new/package.json', { name: '@x/new', version: '1.0.0' });
      const to = commitAll(dir, 'stop excluding b');

      await expect(packagesBefore(runner, { dir, from, to })).resolves.toStrictEqual({
        changedDirs: ['packages/new'],
        namesBefore: [],
      });
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('a range that only added declarations', () => {
  it(
    'is untroubled by a pnpm workspace file appearing beside the manifest',
    async () => {
      expect.hasAssertions();
      const dir = await declaredRepo();
      const from = commitAll(dir, 'one');
      write(dir, 'pnpm-workspace.yaml', 'packages:\n  - tools/*\n');
      write(dir, 'tools/new/package.json', { name: '@x/new', version: '1.0.0' });
      const to = commitAll(dir, 'add pnpm workspaces');

      // The scanner unions both declarations with no precedence between them, so a second file
      // can only widen membership — and the package that arrived with it is still reported.
      await expect(packagesBefore(runner, { dir, from, to })).resolves.toStrictEqual({
        changedDirs: ['tools/new'],
        namesBefore: [],
      });
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'still reports the arrival, since nothing left the scan',
    async () => {
      expect.hasAssertions();
      const dir = await declaredRepo();
      const from = commitAll(dir, 'one');
      // The commonest arrival there is in a repository that lists its members explicitly: the
      // package is added and declared in the same commit. Pattern expansion is monotone, so every
      // previously visible member is still visible and the reconstruction holds.
      write(dir, 'packages/new/package.json', { name: '@x/new', version: '1.0.0' });
      write(dir, 'package.json', {
        name: 'root',
        version: '1.0.0',
        workspaces: ['packages/a', 'packages/b', 'packages/new'],
      });
      const to = commitAll(dir, 'add and declare');

      await expect(packagesBefore(runner, { dir, from, to })).resolves.toStrictEqual({
        changedDirs: ['packages/new'],
        namesBefore: ['root'],
      });
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

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
    'ignores a reordering of the same patterns',
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

      // Order does not change which directories the patterns select, so the inference still holds
      // and the genuinely new package is still reported.
      await expect(packagesBefore(runner, { dir, from, to })).resolves.toStrictEqual({
        changedDirs: ['packages/new'],
        namesBefore: ['root'],
      });
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
