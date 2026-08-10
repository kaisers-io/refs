import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { addCommit, createFixtureRepo, forcePushRewrite } from '../helpers/fixture-repo.ts';
import {
  cloneRepo,
  detectDefaultBranch,
  installHooksGuard,
  isGitCheckout,
  listTags,
  syncRef,
  tagExists,
} from '../../src/git/repo.ts';
import { describe, expect, it } from 'vitest';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { join } from 'node:path';
import { resolveHome } from '../../src/home.ts';
import { tmpdir } from 'node:os';

// Real git integration suite: exercises SpawnRunner against actual git repos ('file://' fixtures),
// Never a mock — this is the one place we prove the exact command sequences in git/repo.ts behave
// The way a managed checkout must: clone blobless, survive a force-pushed upstream, restore a
// Dirty tree back to the tracked state, and refuse to touch a checkout that is not managed.

const TEST_TIMEOUT_MS = 30_000;
const SUCCESS_EXIT_CODE = 0;
const SUITE_OPTS = { timeout: TEST_TIMEOUT_MS };

const runner = new SpawnRunner();

const makeDest = (): Promise<string> => mkdtemp(join(tmpdir(), 'refs-checkout-'));
// `ReturnType<typeof resolveHome>` (not a named `RefsHome` type import) sidesteps this repo's
// Known `no-duplicate-imports` / `consistent-type-specifier-style` conflict — see the identical
// Convention in test/home.test.ts.
const makeHome = async (): Promise<ReturnType<typeof resolveHome>> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-home-'));
  return resolveHome({ REFS_HOME: dir });
};

const plainClone = async (url: string, dest: string): Promise<void> => {
  const result = await runner.run('git', ['clone', '-q', '--', url, dest]);
  if (result.exitCode === SUCCESS_EXIT_CODE) {
    return;
  }
  throw new Error(`test setup clone failed: ${result.stderr}`);
};

// `syncRef()`'s managed-checkout guard requires `core.hooksPath` to be a non-empty value (the
// Marker `cloneRepo` stamps on every checkout it produces) — see the "managed-checkout guard"
// Describe block below. Fixtures that only need a plain clone plus that marker (not the full
// `cloneRepo`/`installHooksGuard` machinery) use this instead of `plainClone` directly.
const MANAGED_HOOKS_MARKER = '/managed-checkout-marker';

const managedClone = async (url: string, dest: string): Promise<void> => {
  await plainClone(url, dest);
  await runner.run('git', ['config', 'core.hooksPath', MANAGED_HOOKS_MARKER], { cwd: dest });
};

const headSha = async (dir: string): Promise<string> => {
  const result = await runner.run('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return result.stdout.trim();
};

// `git clone` never inherits the fixture "remote"'s local config, and CI runners (unlike a
// developer machine) may have no global user.email/user.name at all — without this, a commit in
// the cloned checkout fails with "Author identity unknown" before whatever's under test even
// runs. Local config only, matching this suite's fixture-repo.ts convention.
const setLocalIdentity = async (dir: string): Promise<void> => {
  await runner.run('git', ['config', 'user.email', 'checkout@example.com'], { cwd: dir });
  await runner.run('git', ['config', 'user.name', 'Checkout'], { cwd: dir });
};

// Flattened into top-level `describe`s (rather than one nested block) to keep each function body
// Under this repo's max-lines-per-function limit; `SUITE_OPTS` gives every one the same generous
// Timeout for real git I/O.
describe('cloneRepo()', SUITE_OPTS, () => {
  it('clones blobless from a file:// fixture, configures hooksPath, reports effective mode', async () => {
    expect.hasAssertions();
    const fixture = await createFixtureRepo();
    const home = await makeHome();
    const dest = await makeDest();

    const result = await cloneRepo(runner, {
      cloneUrl: fixture.url,
      dest,
      hooksDir: home.hooksDir,
      mode: 'blobless',
    });

    expect(isGitCheckout(dest)).toBe(true);
    const hooksPath = await runner.run('git', ['config', 'core.hooksPath'], { cwd: dest });
    // `SpawnRunner` never strips a trailing newline the way execa's default `stripFinalNewline`
    // Did — `git config`'s own output always ends in one, so this needs an explicit `.trim()`
    // Where the old execa-backed assertion didn't.
    expect(hooksPath.stdout.trim()).toBe(home.hooksDir);
    /*
     * Empirically verified (git 2.50.1, Apple Git-155, macOS): a plain `file://` remote does NOT
     * honour `--filter=blob:none` unless the source repo explicitly sets
     * `uploadpack.allowFilter=true` — otherwise git emits
     * "warning: filtering not recognized by server, ignoring" and performs a full clone. The
     * fixture never sets that config, so this is the realistic default-server path refs must
     * detect and downgrade `effectiveMode` for.
     */
    expect(result.effectiveMode).toBe('full');
    expect(result.warning).toMatch(/filter/iu);
  });
});

describe('detectDefaultBranch()', SUITE_OPTS, () => {
  it('returns "main" on the fixture', async () => {
    expect.hasAssertions();
    const fixture = await createFixtureRepo();
    const dest = await makeDest();
    await plainClone(fixture.url, dest);

    await expect(detectDefaultBranch(runner, dest)).resolves.toBe('main');
  });
});

describe('syncRef()', SUITE_OPTS, () => {
  it('reports "updated" once the fixture gains a commit after clone', async () => {
    expect.hasAssertions();
    const fixture = await createFixtureRepo();
    const dest = await makeDest();
    await managedClone(fixture.url, dest);
    const oldSha = await headSha(dest);
    await addCommit(fixture.dir, 'more.txt', 'more content\n');

    const result = await syncRef(runner, { defaultBranch: 'main', dir: dest });
    const fixtureHead = await headSha(fixture.dir);

    expect(result).toMatchObject({ newSha: fixtureHead, oldSha, status: 'updated' });
    expect(result.newSha).not.toBe(oldSha);
  });

  it('survives a force-push-style history rewrite without throwing', async () => {
    expect.hasAssertions();
    const fixture = await createFixtureRepo();
    const dest = await makeDest();
    await managedClone(fixture.url, dest);
    await forcePushRewrite(fixture.dir);

    const result = await syncRef(runner, { defaultBranch: 'main', dir: dest });

    expect(result.status).toBe('updated');
    expect(result.newSha).toBe(await headSha(fixture.dir));
  });
});

// Clones a fresh, managed checkout of a fresh fixture — shared setup for the restore-semantics
// Cases (managed so syncRef's managed-checkout guard doesn't reject them).
const cloneFreshCheckout = async (): Promise<string> => {
  const fixture = await createFixtureRepo();
  const dest = await makeDest();
  await managedClone(fixture.url, dest);
  return dest;
};

// Plants a file that git treats as ignored (via `.git/info/exclude`, which does not dirty the
// Working tree the way a tracked `.gitignore` edit would) — must survive a routine sync.
const plantIgnoredArtifact = async (dest: string): Promise<string> => {
  await writeFile(join(dest, '.git', 'info', 'exclude'), 'scratch.txt\n');
  const ignoredFile = join(dest, 'scratch.txt');
  await writeFile(ignoredFile, 'ephemeral analysis artifact\n');
  return ignoredFile;
};

describe('syncRef() restore semantics', SUITE_OPTS, () => {
  it('restores a dirty checkout, reports "restored" with a warning', async () => {
    expect.hasAssertions();
    const dest = await cloneFreshCheckout();
    const dirtFile = join(dest, 'DIRT.md');
    await writeFile(dirtFile, 'uncommitted local edit\n');

    const result = await syncRef(runner, { defaultBranch: 'main', dir: dest });

    expect(result.status).toBe('restored');
    expect(result.warning).toMatch(/read-only/u);
    await expect(access(dirtFile)).rejects.toThrow(/ENOENT/u);
  });

  it('leaves gitignored artifacts alone on a clean sync (no clean -x sweep)', async () => {
    expect.hasAssertions();
    const dest = await cloneFreshCheckout();
    const ignoredFile = await plantIgnoredArtifact(dest);

    const result = await syncRef(runner, { defaultBranch: 'main', dir: dest });

    expect(result.status).toBe('fresh');
    expect(result.warning).toBeUndefined();
    await expect(access(ignoredFile)).resolves.toBeUndefined();
  });

  // Regression test for the restore-order bug: `checkout -B` used to run BEFORE the untracked
  // Checkout was scrubbed, so it refused to overwrite an untracked local file whose path the
  // Fetched branch now tracks. `hardResetToBranch` must clean/reset the dirty checkout first.
  it('restores successfully when an untracked local file collides with a newly-tracked upstream path', async () => {
    expect.hasAssertions();
    const fixture = await createFixtureRepo();
    const dir = await makeDest();
    await managedClone(fixture.url, dir);
    await writeFile(join(dir, 'foo.txt'), 'local untracked content\n');
    await addCommit(fixture.dir, 'foo.txt', 'upstream tracked content\n');

    const result = await syncRef(runner, { defaultBranch: 'main', dir });

    expect(result.status).toBe('restored');
    await expect(readFile(join(dir, 'foo.txt'), 'utf8')).resolves.toBe(
      'upstream tracked content\n',
    );
  });
});

describe('syncRef() managed-checkout guard', SUITE_OPTS, () => {
  it('rejects an unmanaged (plain) git checkout without touching it', async () => {
    expect.hasAssertions();
    const fixture = await createFixtureRepo();
    const dest = await makeDest();
    await plainClone(fixture.url, dest);
    const shaBefore = await headSha(dest);
    await addCommit(fixture.dir, 'more.txt', 'more content\n');

    await expect(syncRef(runner, { defaultBranch: 'main', dir: dest })).rejects.toThrow(
      /not a refs-managed checkout/u,
    );

    await expect(headSha(dest)).resolves.toBe(shaBefore);
  });

  it('accepts a plain checkout when local core.hooksPath is set, treating it as managed', async () => {
    expect.hasAssertions();
    const fixture = await createFixtureRepo();
    const dest = await makeDest();
    await plainClone(fixture.url, dest);
    await runner.run('git', ['config', '--local', 'core.hooksPath', MANAGED_HOOKS_MARKER], {
      cwd: dest,
    });
    const shaBefore = await headSha(dest);
    await addCommit(fixture.dir, 'more.txt', 'more content\n');

    const result = await syncRef(runner, { defaultBranch: 'main', dir: dest });

    expect(result.status).toBe('updated');
    expect(result.newSha).not.toBe(shaBefore);
  });
});

describe('listTags / tagExists', SUITE_OPTS, () => {
  it('orders by -version:refname and reports tag existence', async () => {
    expect.hasAssertions();
    const fixture = await createFixtureRepo({ tags: ['v1.0.0', 'v1.2.0', 'v1.10.0'] });
    const dest = await makeDest();
    await plainClone(fixture.url, dest);

    await expect(listTags(runner, dest)).resolves.toStrictEqual(['v1.10.0', 'v1.2.0', 'v1.0.0']);
    await expect(tagExists(runner, dest, 'v1.2.0')).resolves.toBe(true);
    await expect(tagExists(runner, dest, 'v9.9.9')).resolves.toBe(false);
  });

  it('returns an empty array when the repo has no tags', async () => {
    expect.hasAssertions();
    const fixture = await createFixtureRepo();
    const dest = await makeDest();
    await plainClone(fixture.url, dest);

    await expect(listTags(runner, dest)).resolves.toStrictEqual([]);
  });

  // Regression test: `tagExists` must verify the LITERAL ref, not resolve git revision syntax.
  // `rev-parse --verify` happily peels `refs/tags/v1.0.0^{}` against the existing `v1.0.0` tag
  // (dereferencing it to its commit), which would make a crafted version like `1.0.0^{}` falsely
  // report as an existing tag once rendered through `v{version}`. `show-ref --verify` checks the
  // literal ref name only, with no revision-syntax peeling.
  it('rejects a crafted tag containing git revision syntax even when the base tag exists', async () => {
    expect.hasAssertions();
    const fixture = await createFixtureRepo({ tags: ['v1.0.0'] });
    const dest = await makeDest();
    await plainClone(fixture.url, dest);

    await expect(tagExists(runner, dest, 'v1.0.0^{}')).resolves.toBe(false);
  });
});

describe('installHooksGuard()', SUITE_OPTS, () => {
  it('blocks commits inside a guarded checkout', async () => {
    expect.hasAssertions();
    const [fixture, home] = await Promise.all([createFixtureRepo(), makeHome()]);
    await installHooksGuard(home);
    const dest = await makeDest();
    await cloneRepo(runner, { cloneUrl: fixture.url, dest, hooksDir: home.hooksDir, mode: 'full' });
    await writeFile(join(dest, 'README.md'), 'blocked commit content\n');
    await setLocalIdentity(dest);

    const commit = await runner.run('git', ['commit', '-am', 'should be blocked'], {
      cwd: dest,
    });

    expect(commit.exitCode).not.toBe(SUCCESS_EXIT_CODE);
    expect(commit.stderr).toMatch(/managed read-only/u);
  });
});
