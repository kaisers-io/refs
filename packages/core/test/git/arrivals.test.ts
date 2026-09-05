import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { addedPackageDirs } from '../../src/git/arrivals.ts';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

// Real git, because the whole value of this function is that git — not a scan — answers "what
// appeared between these two commits". A fake runner would only prove the arguments were passed,
// which is exactly the part that is easy to get wrong and impossible to notice.

const runner = new SpawnRunner();

const SHA_HEX_LENGTH = 40;
const NONEXISTENT_SHA = '0'.repeat(SHA_HEX_LENGTH);

const git = (dir: string, ...args: string[]): void => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
};

/** A repo with one commit, plus a helper to add files and commit them. */
const freshGitRepo = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-arrivals-'));
  git(dir, 'init', '-q', '.');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  return dir;
};

const writeManifest = (dir: string, relative: string, name: string): void => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(join(dir, relative), { recursive: true });
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(join(dir, relative, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
};

const commitAll = (dir: string, message: string): string => {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', message);
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
};

describe('which directories a sync range added a manifest to', () => {
  it(
    'names the directory whose manifest the range added, and nothing else',
    async () => {
      expect.hasAssertions();
      const dir = await freshGitRepo();
      writeManifest(dir, 'packages/a', '@x/a');
      const from = commitAll(dir, 'one');
      writeManifest(dir, 'packages/b', '@x/b');
      const to = commitAll(dir, 'two');

      // `packages/a` was there before, so it is not an arrival — which is the entire point:
      // a package the ref's owner never registered stays silent forever, and only what this
      // fetch actually brought in gets reported.
      await expect(addedPackageDirs(runner, { dir, from, to })).resolves.toStrictEqual([
        'packages/b',
      ]);
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'does not mistake a file merely ENDING in package.json for a manifest',
    async () => {
      expect.hasAssertions();
      const dir = await freshGitRepo();
      writeManifest(dir, 'packages/a', '@x/a');
      const from = commitAll(dir, 'one');
      // git's `*package.json` pathspec matches this too — the wildcard is not anchored at a path
      // separator. Verified against git 2.50: it prints BOTH files. The basename check is what
      // makes the result exact, so removing it reports `packages/a` as a new package directory.
      // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
      writeFileSync(join(dir, 'packages/a', 'mypackage.json'), '{}');
      const to = commitAll(dir, 'two');

      await expect(addedPackageDirs(runner, { dir, from, to })).resolves.toStrictEqual([]);
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('paths git would quote', () => {
  it(
    'finds a package directory holding a non-ASCII character',
    async () => {
      expect.hasAssertions();
      const dir = await freshGitRepo();
      writeManifest(dir, 'packages/a', '@x/a');
      const from = commitAll(dir, 'one');
      writeManifest(dir, 'packages/café', '@x/cafe');
      const to = commitAll(dir, 'two');

      // Without `-z`, git's default `core.quotePath` prints this as
      // `"packages/caf\303\251/package.json"` — basename `package.json"`, quote included — so
      // the manifest check drops it and the arrival is missed. HEAD has moved by then, so it is
      // missed permanently, not merely once.
      await expect(addedPackageDirs(runner, { dir, from, to })).resolves.toStrictEqual([
        'packages/café',
      ]);
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'finds a package directory whose name contains a space',
    async () => {
      expect.hasAssertions();
      const dir = await freshGitRepo();
      writeManifest(dir, 'packages/a', '@x/a');
      const from = commitAll(dir, 'one');
      writeManifest(dir, 'packages/with space', '@x/spaced');
      const to = commitAll(dir, 'two');

      await expect(addedPackageDirs(runner, { dir, from, to })).resolves.toStrictEqual([
        'packages/with space',
      ]);
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('a range with nothing to report', () => {
  it(
    'reports nothing when the range is empty',
    async () => {
      expect.hasAssertions();
      const dir = await freshGitRepo();
      writeManifest(dir, 'packages/a', '@x/a');
      const sha = commitAll(dir, 'one');

      // A `fresh` sync: HEAD did not move, so nothing arrived and git is never even asked.
      await expect(addedPackageDirs(runner, { dir, from: sha, to: sha })).resolves.toStrictEqual(
        [],
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'resolves empty rather than throwing when the range cannot be walked',
    async () => {
      expect.hasAssertions();
      const dir = await freshGitRepo();
      writeManifest(dir, 'packages/a', '@x/a');
      const to = commitAll(dir, 'one');

      // A sha this repository has never had — what a shallow checkout looks like once its old
      // sha falls out of the fetched history. A failure to look is never evidence, and it must
      // never fail the sync that asked.
      await expect(
        addedPackageDirs(runner, { dir, from: NONEXISTENT_SHA, to }),
      ).resolves.toStrictEqual([]);
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('the repository root', () => {
  it(
    'excludes the repository root, which is never a workspace member',
    async () => {
      expect.hasAssertions();
      const dir = await freshGitRepo();
      writeManifest(dir, 'docs', 'docs');
      const from = commitAll(dir, 'one');
      // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0' }));
      const to = commitAll(dir, 'two');

      // `dirname('package.json')` is '.', and the root has its own finding (`unregisteredRoot`)
      // that needs no diff. Letting it through here would report it twice.
      await expect(addedPackageDirs(runner, { dir, from, to })).resolves.toStrictEqual([]);
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
