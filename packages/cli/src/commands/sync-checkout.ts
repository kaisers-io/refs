import type { CloneMode, RefEntry, RefKey, RefsHome, Settings } from '@kaisers-io/refs-core';
import { allowFileUrlsFrom, refLockName } from './add-helpers.ts';
import {
  assertInsideSources,
  checkoutPath,
  cloneRepo,
  detectDefaultBranch,
  isGitCheckout,
  resolveSetting,
  syncRef,
  validationError,
  withLock,
  zRefState,
  // eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
} from '@kaisers-io/refs-core';
import {
  ensureCheckoutOrigin,
  ensureManagedCheckout,
  resolveCheckoutHead,
} from './add-checkout-guards.ts';
import type { CliContext } from '../context.ts';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

// The per-ref git pipeline for `sync.ts`/`sync-core.ts` — split out purely to keep both files
// under the repo's 300-line oxlint cap. Owns the missing-checkout re-clone path, the
// existing-checkout sync path (guarded by the same managed-checkout marker `add`'s reuse path
// checks), and the per-ref lock around both. No config/state write happens here — that is
// `sync-state.ts`'s job, under a SEPARATE, sequential (never nested) home-lock acquisition.

type SyncStatus = 'cloned' | 'fresh' | 'restored' | 'updated';

interface RefSyncOutcome {
  headSha: string;
  status: SyncStatus;
  branchRenamedTo?: string;
  effectiveCloneMode?: CloneMode;
  warning?: string;
}

interface RefSyncContext {
  home: RefsHome;
  key: RefKey;
  ref: RefEntry;
  settings: Settings;
}

const unsupportedHeadShaMessage = (key: RefKey, dest: string, sha: string): string =>
  `sync produced a HEAD sha for '${key}' at ${dest} that refs cannot store yet ` +
  `(${sha.length} hex chars) — only SHA-1 repositories are supported for now`;

/** Validates a freshly-observed HEAD sha against `zRefState`'s exact shape before it is ever
 * persisted — mirrors `add-checkout-guards.ts#resolveCheckoutHead`'s own guard, needed again here
 * because `syncRef`'s `newSha` comes from a plain `git rev-parse HEAD`, not from that helper. */
const validateHeadSha = (key: RefKey, dest: string, sha: string): string => {
  if (!zRefState.shape.head_sha.safeParse(sha).success) {
    throw validationError(unsupportedHeadShaMessage(key, dest, sha));
  }
  return sha;
};

interface ClonedFields {
  actualBranch: string;
  headSha: string;
}

/** Shapes a fresh clone's outcome — split out of `syncMissingCheckout` purely to keep that
 * function under the repo's max-statements cap. */
const buildClonedOutcome = (
  rsc: RefSyncContext,
  cloneResult: { effectiveMode: CloneMode; warning?: string },
  fields: ClonedFields,
): RefSyncOutcome => {
  const outcome: RefSyncOutcome = {
    effectiveCloneMode: cloneResult.effectiveMode,
    headSha: fields.headSha,
    status: 'cloned',
  };
  if (fields.actualBranch !== rsc.ref.default_branch) {
    outcome.branchRenamedTo = fields.actualBranch;
  }
  if (cloneResult.warning !== undefined) {
    outcome.warning = cloneResult.warning;
  }
  return outcome;
};

/** Missing-checkout branch: clone fresh (idempotent-clone's non-reuse path), then detect the
 * remote's actual default branch — a rename that happened while the checkout was gone would
 * otherwise go unnoticed, since a fresh `git clone` simply checks out whatever `origin/HEAD` is
 * right now. */
const syncMissingCheckout = async (
  ctx: CliContext,
  rsc: RefSyncContext,
  dest: string,
): Promise<RefSyncOutcome> => {
  await mkdir(dirname(dest), { recursive: true });
  const cloneMode = resolveSetting('clone_mode', rsc.ref, rsc.settings);
  const cloneResult = await cloneRepo(ctx.runner, {
    cloneUrl: rsc.ref.url,
    dest,
    hooksDir: rsc.home.hooksDir,
    mode: cloneMode,
  });
  const actualBranch = await detectDefaultBranch(ctx.runner, dest);
  const headSha = await resolveCheckoutHead(ctx.runner, {
    allowFileUrls: allowFileUrlsFrom(ctx.env),
    dest,
    expectedUrl: rsc.ref.url,
    hooksDir: rsc.home.hooksDir,
    key: rsc.key,
  });
  return buildClonedOutcome(rsc, cloneResult, { actualBranch, headSha });
};

/** Existing-checkout branch: guarded by the exact same managed-checkout marker check `add`'s
 * reuse path uses (`core.hooksPath` equals this home's `hooksDir`) AND the same origin-identity
 * check `add`'s reuse/finalize paths use (`ensureCheckoutOrigin`) — BOTH before `syncRef` ever
 * touches the directory. Without the origin check, a managed checkout whose `origin` remote was
 * repointed at an unrelated repo (hand-edited, or swapped out on disk after `refs add`) would get
 * fetched/hard-reset onto that OTHER repo's history and have the result persisted as if it were
 * the configured ref — silently adopting a different repo's content under the original ref's key.
 * A mismatch throws (fail closed) before any git write touches the checkout. */
const syncExistingCheckout = async (
  ctx: CliContext,
  rsc: RefSyncContext,
  dest: string,
): Promise<RefSyncOutcome> => {
  await ensureManagedCheckout(ctx.runner, { dest, hooksDir: rsc.home.hooksDir });
  await ensureCheckoutOrigin(ctx.runner, {
    allowFileUrls: allowFileUrlsFrom(ctx.env),
    dest,
    expectedUrl: rsc.ref.url,
  });
  const result = await syncRef(ctx.runner, { defaultBranch: rsc.ref.default_branch, dir: dest });
  const headSha = validateHeadSha(rsc.key, dest, result.newSha);
  const outcome: RefSyncOutcome = { headSha, status: result.status };
  if (result.branchRenamedTo !== undefined) {
    outcome.branchRenamedTo = result.branchRenamedTo;
  }
  if (result.warning !== undefined) {
    outcome.warning = result.warning;
  }
  return outcome;
};

/** Runs the git side of one ref's sync under its per-ref lock only — no config/state write here,
 * see `sync-state.ts#applySyncSuccess` for the separate, sequential home-lock step. */
const syncCheckout = (ctx: CliContext, rsc: RefSyncContext): Promise<RefSyncOutcome> =>
  withLock(rsc.home, refLockName(rsc.key), () => {
    const dest = checkoutPath(rsc.home, rsc.key);
    // Containment check at the dispatch level so it covers BOTH branches before any git command
    // or fs operation touches `dest`: an existing path segment under sources/ could be a symlink
    // pointing outside the managed tree — `isGitCheckout`'s existsSync follows it, so without
    // this the EXISTING branch would hard-reset/clean a checkout physically outside sources/,
    // and the MISSING branch's `mkdir`+`cloneRepo` would write outside it.
    assertInsideSources(rsc.home, dest);
    if (!isGitCheckout(dest)) {
      return syncMissingCheckout(ctx, rsc, dest);
    }
    return syncExistingCheckout(ctx, rsc, dest);
  });

export { syncCheckout };
export type { RefSyncContext, RefSyncOutcome, SyncStatus };
