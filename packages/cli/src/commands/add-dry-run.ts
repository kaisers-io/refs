import type {
  CloneMode,
  Proposal,
  RefKey,
  RefState,
  RefsHome,
  TagFormat,
} from '@kaisers-io/refs-core';
import {
  allowFileUrlsFrom,
  applyConfiguredTransport,
  ensureNoCaseCollision,
  ensureNoConflict,
  refLockName,
  resolveAddSource,
} from './add-helpers.ts';
import {
  checkoutPath,
  detectDefaultBranch,
  detectTagFormat,
  detectWorkspacePackages,
  listTags,
  readConfig,
  readState,
  resolveHome,
  resolveSetting,
  withLock,
  writeState,
} from '@kaisers-io/refs-core';
import type { CliContext } from '../context.ts';
import type { ResolvedSource } from './add-helpers.ts';
import { buildProposalPackages } from './add-packages.ts';
import { ensureClonedCheckout } from './add-checkout-guards.ts';
import { progress } from '../output.ts';

// The `--dry-run` core: resolve source → conflict/collision guards → idempotent clone → detect
// default branch/tags/workspace packages → shape a `Proposal`. Shared by both `refs add --dry-run`
// and the `refs add --description` one-shot flow (see `add.ts`). Split out purely to keep `add.ts`
// under the repo's 300-line oxlint cap.

const NO_WARNINGS: readonly string[] = [];

/** Normalizes an optional warning string into the envelope's `warnings` array shape. */
const toWarningsList = (warning: string | undefined): string[] => {
  if (warning === undefined) {
    return [...NO_WARNINGS];
  }
  return [warning];
};

interface DryRunOutcome {
  dest: string;
  effectiveCloneMode?: CloneMode;
  proposal: Proposal;
  warning?: string;
}

interface DetectedFields {
  defaultBranch: string;
  packages: Proposal['packages'];
  tagFormatCandidate: TagFormat | null;
}

const detectProposalFields = async (
  ctx: CliContext,
  dest: string,
  resolved: ResolvedSource,
): Promise<DetectedFields> => {
  const defaultBranch = await detectDefaultBranch(ctx.runner, dest);
  const tags = await listTags(ctx.runner, dest);
  const tagFormatCandidate = detectTagFormat(tags);
  progress(ctx, 'detecting workspace packages…');
  const detected = await detectWorkspacePackages(dest);
  const packages = buildProposalPackages(detected, resolved.npmDirectory, resolved.npmPkgName);
  return { defaultBranch, packages, tagFormatCandidate };
};

interface CloneAndDetectOpts {
  cloneMode: CloneMode;
  dest: string;
  home: RefsHome;
  resolved: ResolvedSource;
}

interface CloneAndDetectResult {
  effectiveMode?: CloneMode;
  fields: DetectedFields;
  warning?: string;
}

// Clone (idempotent — reuses a healthy existing checkout) and detect, both under the per-ref lock:
// keeps the checkout stable between cloning and reading it back, rather than racing a concurrent
// `refs sync`/`refs add` on the same ref.
const cloneAndDetect = (ctx: CliContext, opts: CloneAndDetectOpts): Promise<CloneAndDetectResult> =>
  withLock(opts.home, refLockName(opts.resolved.key), async () => {
    const cloneOutcome = await ensureClonedCheckout(ctx, {
      allowFileUrls: allowFileUrlsFrom(ctx.env),
      cloneUrl: opts.resolved.cloneUrl,
      dest: opts.dest,
      home: opts.home,
      hooksDir: opts.home.hooksDir,
      mode: opts.cloneMode,
    });
    const fields = await detectProposalFields(ctx, opts.dest, opts.resolved);
    const result: CloneAndDetectResult = { fields };
    if (cloneOutcome.effectiveMode !== undefined) {
      result.effectiveMode = cloneOutcome.effectiveMode;
    }
    if (cloneOutcome.warning !== undefined) {
      result.warning = cloneOutcome.warning;
    }
    return result;
  });

interface BuildDryRunOutcomeOpts {
  cloneResult: CloneAndDetectResult;
  dest: string;
  resolved: ResolvedSource;
}

const buildDryRunOutcome = (opts: BuildDryRunOutcomeOpts): DryRunOutcome => {
  const proposal: Proposal = {
    default_branch: opts.cloneResult.fields.defaultBranch,
    description: '',
    key: opts.resolved.key,
    packages: opts.cloneResult.fields.packages,
    tag_format_candidate: opts.cloneResult.fields.tagFormatCandidate,
    url: opts.resolved.cloneUrl,
  };
  const outcome: DryRunOutcome = { dest: opts.dest, proposal };
  if (opts.cloneResult.effectiveMode !== undefined) {
    outcome.effectiveCloneMode = opts.cloneResult.effectiveMode;
  }
  if (opts.cloneResult.warning !== undefined) {
    outcome.warning = opts.cloneResult.warning;
  }
  return outcome;
};

const runDryRunCore = async (ctx: CliContext, source: string): Promise<DryRunOutcome> => {
  const home = resolveHome(ctx.env);
  const config = await readConfig(home);
  // The transport rewrite (npm:-resolved sources only — see `applyConfiguredTransport`) happens
  // here, before the clone and before the url is captured into the proposal below, so both the
  // checkout's origin remote and the stored entry `url` carry the configured transport.
  const resolved = applyConfiguredTransport(await resolveAddSource(ctx, source), config.settings);
  ensureNoConflict(config, resolved.key);
  await ensureNoCaseCollision(home, resolved.key);
  const dest = checkoutPath(home, resolved.key);
  const cloneMode = resolveSetting('clone_mode', undefined, config.settings);
  const cloneResult = await cloneAndDetect(ctx, { cloneMode, dest, home, resolved });
  return buildDryRunOutcome({ cloneResult, dest, resolved });
};

/** Records that a dry-run proposal is pending for `key` — cleared again once `--proposal`/
 * `--description` finalizes it (see `finalizeRef` in `add.ts`). Also persists `effectiveCloneMode`
 * when this dry-run actually cloned (see `ensureClonedCheckout`'s partial-clone-fallback note) so a
 * later `--proposal` finalize — which never re-clones — can recover the real mode used instead of
 * silently guessing the global default.
 *
 * Re-checks the conflict guard again here, under the home lock: `runDryRunCore`'s own
 * `ensureNoConflict` call ran unlocked, earlier — a `--proposal`/`--description` finalize could
 * race in between and configure `key` before this lock is acquired, which would otherwise re-add
 * `pending_proposal_at` onto an already-configured ref. */
const writePendingProposal = (
  home: RefsHome,
  key: RefKey,
  effectiveCloneMode: CloneMode | undefined,
): Promise<void> =>
  withLock(home, 'home', async () => {
    const config = await readConfig(home);
    ensureNoConflict(config, key);
    const state = await readState(home);
    const previous = state.refs[key];
    const resolvedMode = effectiveCloneMode ?? previous?.effective_clone_mode;
    const nextState: RefState = { ...previous, pending_proposal_at: new Date().toISOString() };
    if (resolvedMode !== undefined) {
      nextState.effective_clone_mode = resolvedMode;
    }
    state.refs[key] = nextState;
    await writeState(home, state);
  });

export { runDryRunCore, toWarningsList, writePendingProposal };
export type { DryRunOutcome };
