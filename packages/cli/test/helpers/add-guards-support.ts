import type { Proposal, RefsHome } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { SpawnRunner, checkoutPath, readConfig, resolveHome } from '@kaisers-io/refs-core';
import { access, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { initHome, realContextFor, runAddDryRunJson } from './add-support.ts';
import type { CliContext } from '../../src/context.ts';
import type { ResolvedSource } from '../../src/commands/add-source.ts';
import { createFixtureRepo } from './fixture-repo.ts';
import { expect } from 'vitest';
import { join } from 'node:path';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { resolveAddSource } from '../../src/commands/add-source.ts';
import { tmpdir } from 'node:os';

// Scaffolding specific to `add-guards.test.ts`'s review-round regression suite (checkout-identity
// verification, the corrupt-checkout finalize guard, the pending-proposal race guard, and the
// repeated-`--dry-run` regression) — kept out of `add-support.ts` purely to keep both helper
// files, and `add-guards.test.ts` itself, under the repo's 300-line oxlint cap. Reuses
// `add-support.ts`'s own scaffolding (`realContextFor`, `initHome`, etc.) rather than
// duplicating it.

const GIT_SUCCESS_EXIT_CODE = 0;
const MARKER_NAME = '.refs-test-marker';
const DEFAULT_TAGS = ['v1.0.0'];

const expectRefNotConfigured = async (home: RefsHome, key: string): Promise<void> => {
  const config = await readConfig(home);
  expect(config.refs[key]).toBeUndefined();
};

type DryRunFixture = {
  ctx: CliContext;
  dest: string;
  home: RefsHome;
  proposal: Proposal;
  sourceUrl: string;
  stdout: string[];
};

// `exactOptionalPropertyTypes` forbids assigning a `boolean | undefined` value directly onto
// `FixtureOpts.monorepo?: boolean` — built field-by-field so `monorepo` is only ever set when
// the caller actually asked for one, mirroring `add.ts#buildAddOptions`'s own comment.
const buildFixtureOpts = (
  monorepo: boolean | undefined,
): { monorepo?: boolean; tags: string[] } => {
  if (monorepo === undefined) {
    return { tags: DEFAULT_TAGS };
  }
  return { monorepo, tags: DEFAULT_TAGS };
};

/** Bootstraps a fresh temp home, inits it, seeds a fixture repo, and runs `--dry-run` against it —
 * the common setup every checkout-identity/race/reuse guard test needs, collapsed into one call so
 * each test stays under the repo's `max-statements` cap. */
const setupDryRunFixture = async (
  homeDir: string,
  opts?: { monorepo?: boolean },
): Promise<DryRunFixture> => {
  const { ctx, stdout } = realContextFor(homeDir);
  await initHome(ctx);
  const fixture = await createFixtureRepo(buildFixtureOpts(opts?.monorepo));
  const proposal = await runAddDryRunJson(ctx, stdout, fixture.url);
  const home = resolveHome(ctx.env);
  const dest = checkoutPath(home, proposal.key);
  return { ctx, dest, home, proposal, sourceUrl: fixture.url, stdout };
};

type SourceFixture = {
  ctx: CliContext;
  dest: string;
  home: RefsHome;
  resolved: ResolvedSource;
  sourceUrl: string;
  stdout: string[];
};

/** Like `setupDryRunFixture`, but stops right after resolving the source (no clone yet) — needed
 * by the checkout-identity guard test that must pre-create a bogus checkout at the derived path
 * BEFORE `refs add --dry-run` itself ever runs. */
const setupSourceFixture = async (homeDir: string): Promise<SourceFixture> => {
  const { ctx, stdout } = realContextFor(homeDir);
  await initHome(ctx);
  const fixture = await createFixtureRepo({ tags: DEFAULT_TAGS });
  const resolved = await resolveAddSource(ctx, fixture.url);
  const home = resolveHome(ctx.env);
  const dest = checkoutPath(home, resolved.key);
  return { ctx, dest, home, resolved, sourceUrl: fixture.url, stdout };
};

// Reused for test SETUP git calls only (never the code under test) — a second, throwaway
// `SpawnRunner` rather than a raw `child_process` call of its own, purely to keep this file's
// distinct-module count under the repo's `max-dependencies` cap.
const setupRunner = new SpawnRunner();

/** Runs a git command for test SETUP only (never the code under test) — mirrors
 * `fixture-repo.ts`'s own local `git` helper, duplicated here for the same reason (see that
 * file's header comment: no cross-package test imports, this package's tsconfig only includes
 * its own `src`/`test`). */
const gitFor = async (dir: string, args: readonly string[]): Promise<void> => {
  const result = await setupRunner.run('git', args, { cwd: dir });
  if (result.exitCode !== GIT_SUCCESS_EXIT_CODE) {
    throw new Error(`test setup: git ${args.join(' ')} failed: ${result.stderr}`);
  }
};

/** Corrupts an already-cloned checkout's `HEAD` (points it at a branch that doesn't exist) so
 * `git rev-parse HEAD` fails while `.git` itself — and its `origin` remote config — stay intact.
 * Simulates a corrupt-but-present checkout for the finalize-time `resolveCheckoutHead` guard
 * without also tripping the earlier, unrelated `isGitCheckout` existence check. */
const corruptCheckoutHead = (dest: string): Promise<void> =>
  writeFile(join(dest, '.git', 'HEAD'), 'ref: refs/heads/does-not-exist\n');

/** Pre-creates `dest` as its own real (but unmanaged) git repo pointing at `originUrl` — used to
 * simulate an unrelated checkout already occupying the derived path, never having gone through
 * `refs add` itself, for the checkout-identity guard's target scenario. */
const createBogusCheckout = async (dest: string, originUrl: string): Promise<void> => {
  await mkdir(dest, { recursive: true });
  await gitFor(dest, ['init', '-q', '-b', 'main']);
  await gitFor(dest, ['remote', 'add', 'origin', originUrl]);
};

/** A REAL `git clone` of `sourceUrl` into `dest` — same origin `refs add` would derive, but never
 * stamped with the `core.hooksPath` marker `cloneRepo` sets on every checkout it creates. Simulates
 * a user's own manual clone of the same repo landing at the exact path `refs` would derive for the
 * reuse-path managed-checkout guard: origin matches, but it never went through `refs add`. */
const createManualCheckout = async (sourceUrl: string, dest: string): Promise<void> => {
  const result = await setupRunner.run('git', ['clone', '-q', sourceUrl, dest]);
  if (result.exitCode !== GIT_SUCCESS_EXIT_CODE) {
    throw new Error(`test setup: git clone failed: ${result.stderr}`);
  }
};

/** Repoints an existing (real, refs-managed) checkout's `origin` remote — simulates the checkout
 * having drifted from what a proposal/config expects between `--dry-run` and finalize. */
const setCheckoutOrigin = (dest: string, originUrl: string): Promise<void> =>
  gitFor(dest, ['remote', 'set-url', 'origin', originUrl]);

/** Drops an inert marker file directly into `dest` — its continued presence after a second
 * `--dry-run`/finalize proves the checkout was reused rather than wiped and re-cloned. */
const markCheckout = (dest: string): Promise<void> => writeFile(join(dest, MARKER_NAME), 'marker');

const expectCheckoutReused = (dest: string): Promise<void> =>
  expect(access(join(dest, MARKER_NAME))).resolves.toBeUndefined();

/** Removes `dir` (if present) and replaces it with a symlink to a fresh, empty external tmp
 * directory — the generic "existing path segment under sources/ is a symlink pointing outside the
 * managed tree" fixture shared by the fresh-clone (`add`) and re-clone (`sync`) containment guard
 * tests. Returns the external directory so callers can assert nothing was written into it. */
const plantSymlinkedAncestor = async (dir: string): Promise<string> => {
  const outside = await mkdtemp(join(tmpdir(), 'refs-containment-outside-'));
  await rm(dir, { force: true, recursive: true });
  await symlink(outside, dir);
  return outside;
};

/** Moves `dir`'s real content (including any live git checkouts under it) to a fresh external tmp
 * directory and replaces `dir` with a symlink pointing at it — the "EXISTING checkout physically
 * outside sources/ behind a symlinked ancestor" fixture for the reuse-branch (`add`) and
 * existing-checkout (`sync`) containment guard tests, where `isGitCheckout(dest)` must come back
 * true through the symlink. Returns the external directory now holding the relocated content so
 * callers can prove it was never mutated. */
const relocateBehindSymlink = async (dir: string): Promise<string> => {
  const outside = await mkdtemp(join(tmpdir(), 'refs-containment-outside-'));
  const target = join(outside, 'relocated');
  await rename(dir, target);
  await symlink(target, dir);
  return target;
};

export {
  corruptCheckoutHead,
  createBogusCheckout,
  createManualCheckout,
  expectCheckoutReused,
  expectRefNotConfigured,
  markCheckout,
  plantSymlinkedAncestor,
  relocateBehindSymlink,
  setCheckoutOrigin,
  setupDryRunFixture,
  setupSourceFixture,
};
