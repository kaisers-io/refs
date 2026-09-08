import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { packagesBefore } from '../../src/git/arrivals.ts';
import { tmpdir } from 'node:os';

// Real git, because the whole value of this function is that git — not a scan — says what the
// repository's packages looked like before a range. A fake runner would only prove the arguments
// were passed, which is exactly the part that is easy to get wrong and impossible to notice.

const runner = new SpawnRunner();
const SHA_HEX_LENGTH = 40;
const NONEXISTENT_SHA = '0'.repeat(SHA_HEX_LENGTH);

const git = (dir: string, ...args: string[]): void => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
};

const freshGitRepo = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-arrivals-'));
  git(dir, 'init', '-q', '.');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  return dir;
};

const writeManifest = (
  dir: string,
  relative: string,
  manifest: { extra?: Record<string, unknown>; name: string },
): void => {
  const { extra = {}, name } = manifest;
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(join(dir, relative), { recursive: true });
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(
    join(dir, relative, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', ...extra }),
  );
};

const removeDir = (dir: string, relative: string): void => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  rmSync(join(dir, relative), { force: true, recursive: true });
};

const commitAll = (dir: string, message: string): string => {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', message);
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
};

describe('what the repository had before a range', () => {
  it(
    'reports the pre-range name of a manifest the range changed',
    async () => {
      expect.hasAssertions();
      const dir = await freshGitRepo();
      writeManifest(dir, 'packages/b', { name: '@x/b' });
      const from = commitAll(dir, 'one');
      // Renamed in place: the manifest is MODIFIED, not added, so a path-based reading would see
      // nothing at all and miss that `@x/c` is a name the repository did not have.
      writeManifest(dir, 'packages/b', { name: '@x/c' });
      const to = commitAll(dir, 'two');

      await expect(packagesBefore(runner, { dir, from, to })).resolves.toStrictEqual({
        changedDirs: ['packages/b'],
        namesBefore: ['@x/b'],
      });
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'reports a moved package under the name it already had',
    async () => {
      expect.hasAssertions();
      const dir = await freshGitRepo();
      writeManifest(dir, 'packages/b', { name: '@x/b' });
      const from = commitAll(dir, 'one');
      removeDir(dir, 'packages/b');
      writeManifest(dir, 'packages/moved', { name: '@x/b' });
      const to = commitAll(dir, 'two');

      // Both directories are changed, and `@x/b` is named among what existed — so a caller seeing
      // `@x/b` at `packages/moved` can tell it moved rather than arrived.
      await expect(packagesBefore(runner, { dir, from, to })).resolves.toStrictEqual({
        changedDirs: ['packages/b', 'packages/moved'],
        namesBefore: ['@x/b'],
      });
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('a directory that had no manifest before', () => {
  it(
    'names nothing for it',
    async () => {
      expect.hasAssertions();
      const dir = await freshGitRepo();
      writeManifest(dir, 'packages/a', { name: '@x/a' });
      const from = commitAll(dir, 'one');
      writeManifest(dir, 'packages/new', { name: '@x/new' });
      const to = commitAll(dir, 'two');

      // `packages/a` is untouched, so it is absent from `changedDirs` and its name never had to be
      // read — the caller supplies it from its own scan.
      await expect(packagesBefore(runner, { dir, from, to })).resolves.toStrictEqual({
        changedDirs: ['packages/new'],
        namesBefore: [],
      });
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('a deletion git could pair with an addition', () => {
  it(
    'sees both paths rather than one rename',
    async () => {
      expect.hasAssertions();
      const dir = await freshGitRepo();
      // A manifest substantial enough for git's similarity index to pair the two — the ordinary
      // case, not a contrived one: package manifests share their fields and their shape.
      const shared = {
        dependencies: { left: '1', middle: '2', right: '3' },
        description: 'A package whose manifest is long enough to look similar to its successor',
        scripts: { build: 'tsc', test: 'vitest' },
      };
      writeManifest(dir, 'packages/old', { extra: shared, name: '@x/old' });
      const from = commitAll(dir, 'one');
      removeDir(dir, 'packages/old');
      writeManifest(dir, 'packages/new', { extra: shared, name: '@x/new' });
      const to = commitAll(dir, 'two');

      // Verified against git 2.50: with rename detection left on, this pair is reported as `R068`
      // and neither path shows up as changed on its own.
      await expect(packagesBefore(runner, { dir, from, to })).resolves.toStrictEqual({
        changedDirs: ['packages/new', 'packages/old'],
        namesBefore: ['@x/old'],
      });
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('paths git would quote', () => {
  it(
    'reads a package directory holding a non-ASCII character',
    async () => {
      expect.hasAssertions();
      const dir = await freshGitRepo();
      writeManifest(dir, 'packages/café', { name: '@x/cafe' });
      const from = commitAll(dir, 'one');
      writeManifest(dir, 'packages/café', { name: '@x/renamed' });
      const to = commitAll(dir, 'two');

      // Without `-z`, git's default `core.quotePath` prints this as
      // `"packages/caf\303\251/package.json"` — basename `package.json"`, quote included — so the
      // manifest check drops it and the change is never seen. HEAD has moved by then, so it is
      // missed permanently, not merely once.
      await expect(packagesBefore(runner, { dir, from, to })).resolves.toStrictEqual({
        changedDirs: ['packages/café'],
        namesBefore: ['@x/cafe'],
      });
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('the repository root', () => {
  it(
    'is not offered as a changed member directory',
    async () => {
      expect.hasAssertions();
      const dir = await freshGitRepo();
      writeManifest(dir, 'docs', { name: 'docs' });
      const from = commitAll(dir, 'one');
      // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0' }));
      const to = commitAll(dir, 'two');

      // `dirname('package.json')` is '.', and the root has its own finding (`unregisteredRoot`)
      // that needs no range to reach it.
      await expect(packagesBefore(runner, { dir, from, to })).resolves.toStrictEqual({
        changedDirs: [],
        namesBefore: [],
      });
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('a range with nothing to say', () => {
  it(
    'reports an empty before-picture when HEAD did not move',
    async () => {
      expect.hasAssertions();
      const dir = await freshGitRepo();
      writeManifest(dir, 'packages/a', { name: '@x/a' });
      const sha = commitAll(dir, 'one');

      await expect(packagesBefore(runner, { dir, from: sha, to: sha })).resolves.toStrictEqual({
        changedDirs: [],
        namesBefore: [],
      });
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('a range that cannot be established', () => {
  it(
    'resolves undefined rather than throwing when it cannot be walked',
    async () => {
      expect.hasAssertions();
      const dir = await freshGitRepo();
      writeManifest(dir, 'packages/a', { name: '@x/a' });
      const to = commitAll(dir, 'one');

      // A sha this repository has never had — what a shallow checkout looks like once its old sha
      // falls out of the fetched history. `undefined` is "nothing can be said", which a caller
      // must read as reporting nothing, never as "nothing existed before".
      await expect(
        packagesBefore(runner, { dir, from: NONEXISTENT_SHA, to }),
      ).resolves.toBeUndefined();
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'resolves undefined when a changed manifest cannot be parsed at the old revision',
    async () => {
      expect.hasAssertions();
      const dir = await freshGitRepo();
      // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
      mkdirSync(join(dir, 'packages/broken'), { recursive: true });
      // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
      writeFileSync(join(dir, 'packages/broken/package.json'), '{ not json');
      const from = commitAll(dir, 'one');
      writeManifest(dir, 'packages/broken', { name: '@x/fixed' });
      const to = commitAll(dir, 'two');

      // A name that could not be read is a name that cannot be ruled out as pre-existing. Skipping
      // it would let a package that was there all along be announced as new.
      await expect(packagesBefore(runner, { dir, from, to })).resolves.toBeUndefined();
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
