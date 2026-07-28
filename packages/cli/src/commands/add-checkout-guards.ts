import type { CloneMode, RefKey, RefsHome, Runner } from '@kaisers-io/refs-core';
import {
  assertInsideSources,
  canonicalizeGitUrl,
  cloneRepo,
  conflictError,
  isGitCheckout,
  redactUrl,
  validationError,
  zRefState,
} from '@kaisers-io/refs-core';
import type { CliContext } from '../context.ts';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { progress } from '../output.ts';

// Checkout-identity + head-sha guards shared by `refs add`'s idempotent clone/finalize flow and
// `refs sync`'s per-ref pipeline (`sync-checkout.ts`). Owns everything that runs AGAINST an
// already-existing (or just-cloned) checkout directory: origin identity verification, the
// reuse-path managed-checkout marker check, and the finalize-time `HEAD` sha
// resolution/validation. Source resolution and the pre-clone case-collision guard live in
// `add-source.ts`.

const SUCCESS_EXIT_CODE = 0;

// BOTH url slots are redacted: `actual` comes straight from `git remote get-url origin` — a real
// checkout's origin may itself carry embedded credentials (`https://token@host/...`) — and
// `expectedUrl` can carry them too: a `refs add --proposal` payload's `url` is only checked to be
// a non-empty string by `zFinalProposal`, so a credentialed url reaches this message verbatim;
// this error also lands in logs, not just the invoking terminal.
const originMismatchMessage = (dest: string, actual: string, expectedUrl: string): string =>
  `checkout at ${dest} points at '${redactUrl(actual)}' — expected '${redactUrl(expectedUrl)}'; ` +
  'remove the checkout directory or run refs remove before retrying';

const NO_ORIGIN_MARKER = '(no origin remote)';

/** The trimmed origin url on success, or the `(no origin remote)` marker when the lookup failed. */
const originOrMarker = (result: { exitCode: number; stdout: string }): string => {
  if (result.exitCode === SUCCESS_EXIT_CODE) {
    return result.stdout.trim();
  }
  return NO_ORIGIN_MARKER;
};

/** Canonicalizes `url` into its identity `key`, or `undefined` when it doesn't even parse as a
 * supported git url (an exotic/unsupported remote form) — callers treat that as a mismatch (fail
 * closed) rather than letting an uncomparable origin slide through unchecked. */
const originIdentityKey = (url: string, allowFileUrls: boolean): RefKey | undefined => {
  try {
    return canonicalizeGitUrl(url, { allowFileUrls }).key;
  } catch {
    return undefined;
  }
};

/** Verifies `opts.dest`'s `origin` remote resolves to the SAME repo IDENTITY as `opts.expectedUrl`
 * — compared via `canonicalizeGitUrl`'s canonical `key`, not byte-exact url equality. This
 * deliberately tolerates cosmetic variance (a trailing `.git`, host casing) and even transport
 * differences (`ssh://` vs `https://` of the same repo), treating them as the same identity. A
 * failed `git remote get-url origin` (not a repo, no such remote) — or EITHER side (actual origin
 * or `opts.expectedUrl` itself) failing to canonicalize (some exotic/unsupported remote form) — is
 * treated as a mismatch too (fail closed, via `originIdentityKey`'s shared `undefined`-on-failure
 * handling for both sides), rendered as `(no origin remote)` in the error rather than surfacing raw
 * git stderr, or letting an uncomparable `opts.expectedUrl` slip through as a generic parse error
 * instead of this guard's actionable conflict message. */
const ensureCheckoutOrigin = async (
  runner: Runner,
  opts: { allowFileUrls: boolean; dest: string; expectedUrl: string },
): Promise<void> => {
  const result = await runner.run('git', ['remote', 'get-url', 'origin'], { cwd: opts.dest });
  const actual = originOrMarker(result);
  const expectedKey = originIdentityKey(opts.expectedUrl, opts.allowFileUrls);
  const actualKey = originIdentityKey(actual, opts.allowFileUrls);
  if (expectedKey !== undefined && actualKey === expectedKey) {
    return;
  }
  throw conflictError(originMismatchMessage(opts.dest, actual, opts.expectedUrl));
};

const unmanagedCheckoutMessage = (dest: string): string =>
  `checkout at ${dest} exists but is not refs-managed — remove it (rm -rf ${dest}) and retry`;

/** Reuse-path-only guard: confirms `dest` is a checkout `refs` itself produced — the `cloneRepo`
 * marker (`core.hooksPath` pointing at this home's `hooksDir`) — rather than merely a directory
 * that happens to occupy the derived path and share the expected origin (e.g. a manual `git
 * clone` of the same repo, made before `refs add` ever ran against it). Adopting such a checkout
 * silently would be unsafe: a later `refs sync` hard-resets/cleans it (see `syncRef` in core),
 * which would destroy any history or work-in-progress the manual clone carried. Never applied
 * after a fresh clone — `cloneRepo` always stamps the marker itself, so a checkout we just created
 * is trusted unconditionally. */
const ensureManagedCheckout = async (
  runner: Runner,
  opts: { dest: string; hooksDir: string },
): Promise<void> => {
  const result = await runner.run('git', ['config', '--local', 'core.hooksPath'], {
    cwd: opts.dest,
  });
  if (result.exitCode !== SUCCESS_EXIT_CODE || result.stdout.trim() !== opts.hooksDir) {
    throw conflictError(unmanagedCheckoutMessage(opts.dest));
  }
};

type CloneCheckoutOpts = {
  allowFileUrls: boolean;
  cloneUrl: string;
  dest: string;
  home: RefsHome;
  hooksDir: string;
  mode: CloneMode;
};

// The fresh-clone branch of `ensureClonedCheckout` (`dest` doesn't exist as a checkout yet):
// creates `dest`'s parent directories, emits the `cloning …` progress line (see
// `output.ts#progress`), then clones.
const cloneFresh = async (
  ctx: CliContext,
  opts: CloneCheckoutOpts,
): Promise<{ effectiveMode?: CloneMode; warning?: string }> => {
  await mkdir(dirname(opts.dest), { recursive: true });
  progress(ctx, `cloning ${redactUrl(opts.cloneUrl)} into ${opts.dest}…`);
  const result = await cloneRepo(ctx.runner, opts);
  if (result.warning === undefined) {
    return { effectiveMode: result.effectiveMode };
  }
  return { effectiveMode: result.effectiveMode, warning: result.warning };
};

/** Idempotent clone: reuses an already-healthy checkout (a `.git` dir already exists at `dest`)
 * rather than re-cloning, otherwise clones fresh — creating `dest`'s parent directories first.
 * `effectiveMode` is only known (and returned) when a clone actually ran: `cloneRepo` may downgrade
 * a requested `'blobless'` clone to `'full'` when the remote doesn't honour the partial-clone
 * filter (see `git/repo.ts#cloneRepo`), so callers must not assume the requested mode was used.
 * When *reusing* rather than cloning fresh, `opts.dest`'s origin identity must match
 * `opts.cloneUrl`'s (see `ensureCheckoutOrigin`) AND `opts.dest` must carry the refs-managed marker
 * (see `ensureManagedCheckout`) — a freshly-cloned checkout is trusted unconditionally for both,
 * since we just created it (and stamped the marker) ourselves. `opts.dest` is
 * containment-checked (`assertInsideSources`) up front, before EITHER branch — an existing
 * ancestor path segment under `opts.home.sourcesDir` could be a symlink pointing outside it (e.g.
 * a nested ref's checkout turned into a symlink), which would otherwise make the fresh clone
 * write outside the managed tree, or make the reuse branch ADOPT a checkout that physically lives
 * outside it (`isGitCheckout`'s existsSync follows symlinked ancestors) — every later sync would
 * then operate out there. */
const ensureClonedCheckout = async (
  ctx: CliContext,
  opts: CloneCheckoutOpts,
): Promise<{ effectiveMode?: CloneMode; warning?: string }> => {
  assertInsideSources(opts.home, opts.dest);
  if (isGitCheckout(opts.dest)) {
    await ensureCheckoutOrigin(ctx.runner, {
      allowFileUrls: opts.allowFileUrls,
      dest: opts.dest,
      expectedUrl: opts.cloneUrl,
    });
    await ensureManagedCheckout(ctx.runner, { dest: opts.dest, hooksDir: opts.hooksDir });
    return {};
  }
  return cloneFresh(ctx, opts);
};

const revParseFailedMessage = (key: RefKey, dest: string): string =>
  `checkout for '${key}' at ${dest} is missing or corrupt (git rev-parse HEAD failed) — ` +
  `run: refs remove ${key}, then refs add <source> --dry-run again`;

const HEAD_SHA_HEX_LENGTH = 40;

const unsupportedHeadShaMessage = (key: RefKey, dest: string, sha: string): string =>
  `checkout for '${key}' at ${dest} has a HEAD sha refs cannot store yet (${sha.length} hex ` +
  `chars, expected ${HEAD_SHA_HEX_LENGTH}) — only SHA-1 repositories are supported for now; ` +
  '`--object-format=sha256` repositories are not yet supported';

/** Resolves the finalize-time `HEAD` sha for `opts.dest`, verifying (in order) that its origin
 * identity still matches `opts.expectedUrl` (see `ensureCheckoutOrigin`), that `opts.dest` still
 * carries the refs-managed marker (see `ensureManagedCheckout`) — otherwise a checkout dry-run
 * created could be swapped out for an unmanaged manual clone of the SAME origin before finalize
 * ever runs, which would adopt it (config written) despite `refs sync` later hard-resetting/
 * cleaning it (see `ensureManagedCheckout`'s own comment) — that `git rev-parse HEAD` actually
 * succeeds — `Runner.run` never throws on a non-zero exit, so a corrupt/removed checkout would
 * otherwise hand back garbage `stdout` instead of failing — AND that the resulting sha has the
 * exact shape `zState`'s `head_sha` field requires (imported from core, not retyped locally): a
 * SHA-256 (`--object-format=sha256`) repo yields a 64-character HEAD, rejected here so finalize
 * fails before any document is built or written (see `finalizeRef` in `add-finalize.ts`). Called
 * under the per-ref lock, strictly before any config/state write, so any of these failures is
 * caught before anything is persisted. */
const resolveCheckoutHead = async (
  runner: Runner,
  opts: {
    allowFileUrls: boolean;
    dest: string;
    expectedUrl: string;
    hooksDir: string;
    key: RefKey;
  },
): Promise<string> => {
  await ensureCheckoutOrigin(runner, opts);
  await ensureManagedCheckout(runner, { dest: opts.dest, hooksDir: opts.hooksDir });
  const headResult = await runner.run('git', ['rev-parse', 'HEAD'], { cwd: opts.dest });
  if (headResult.exitCode !== SUCCESS_EXIT_CODE) {
    throw validationError(revParseFailedMessage(opts.key, opts.dest));
  }
  const sha = headResult.stdout.trim();
  const parsed = zRefState.shape.head_sha.safeParse(sha);
  if (!parsed.success) {
    throw validationError(unsupportedHeadShaMessage(opts.key, opts.dest, sha));
  }
  return sha;
};

export { ensureCheckoutOrigin, ensureClonedCheckout, ensureManagedCheckout, resolveCheckoutHead };
