import type {
  CloneMode,
  Proposal,
  RefKey,
  RefState,
  RefsHome,
  TagFormat,
  WorkspaceScan,
} from '@kaisers-io/refs-core';
import {
  allowFileUrlsFrom,
  applyConfiguredTransport,
  ensureNoCaseCollision,
  ensureNoConflict,
  refLockName,
  resolveAddSource,
} from './add-source.ts';
import { buildProposalPackages, registeredRootName } from './add-packages.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import {
  checkoutPath,
  detectDefaultBranch,
  detectTagFormat,
  detectWorkspacePackagesDetailed,
  listTags,
  readConfig,
  readState,
  resolveHome,
  resolveSetting,
  scanIsReliable,
  withLock,
  writeState,
} from '@kaisers-io/refs-core';
import type { CliContext } from '../context.ts';
import type { ResolvedSource } from './add-source.ts';
import { discoveryObstacle } from './workspace-diagnostics.ts';
import { ensureClonedCheckout } from './add-checkout-guards.ts';
import { progress } from '../output.ts';

// The `--dry-run` core: resolve source → conflict/collision guards → idempotent clone → detect
// default branch/tags/workspace packages → shape a `Proposal`. Shared by both `refs add --dry-run`
// and the `refs add --description` one-shot flow (see `add.ts`).

type DryRunOutcome = {
  dest: string;
  /** Two independent things can be worth saying about one dry-run — the clone fell back, and the
   * scan could not read the workspace declaration — so they are collected rather than competing
   * for one `warning` field. The envelope's `warnings` is already an array. */
  detectionWarning?: string;
  effectiveCloneMode?: CloneMode;
  proposal: Proposal;
  /** The detected workspace root's package name, when its manifest declares one. Carried on the
   * in-process outcome rather than in the serialized `Proposal`: only the one-shot `--description`
   * flow needs it (to know which entry the ref's own description may describe), and the two-phase
   * flow gets its descriptions from a human instead. Adding it to the proposal file would change a
   * published format for a fact nobody reading that file needs. */
  rootPackageName?: string;
  warning?: string;
};

type DetectedFields = {
  defaultBranch: string;
  /** Why this proposal's `packages` may be short, when the scan said so. A repository declaring
   * `packages/**` — a pattern the classifier cannot expand — detects NOTHING, and an empty
   * `packages` record is also what an ordinary single-package repository produces. The two are
   * indistinguishable to whoever reads the proposal, and `ADD.md` gives them no reason to doubt
   * the empty one, so the difference has to be said out loud. */
  detectionWarning?: string;
  packages: Proposal['packages'];
  rootPackageName?: string;
  tagFormatCandidate: TagFormat | null;
};

/** Said out loud, or `undefined` when the scan needs nothing said.
 *
 * `add` used to call a wrapper that dropped the scan's diagnostics, on the grounds that it is
 * best-effort and has an agent to fill the gaps. That holds for a gap the agent can SEE. It cannot
 * fill in packages nobody told it exist — and a thin `packages` record is exactly what an ordinary
 * repository produces too, so there is nothing in the result to doubt.
 *
 * Worded for both flows. `--dry-run` returns a proposal nobody has approved; the `--description`
 * one-shot has already written the config entry by the time this reaches the reader, and telling
 * them to check something "before approving" would describe a step that is over. What is true in
 * both is that the detected list may be short and the repository's own declaration settles it.
 *
 * "Could not fully inspect the declared workspaces", not "could not read the declaration": the
 * declaration may parse and expand perfectly while a member manifest is unreadable or a candidate
 * directory was never inspected. `scanIsReliable` covers all of those. */
const detectionWarningFor = (scan: WorkspaceScan): string | undefined =>
  scanIsReliable(scan)
    ? undefined
    : `workspace detection could not fully inspect the declared workspaces ` +
      `(${discoveryObstacle(scan)}) — members may be missing from the detected packages; the ` +
      "repository's own workspace declaration is what settles it";

type DetectionContext = {
  defaultBranch: string;
  resolved: ResolvedSource;
  tagFormatCandidate: TagFormat | null;
};

/** Shapes one scan into the proposal's detected half. Built key-by-key rather than spread, because
 * `exactOptionalPropertyTypes` distinguishes an absent key from one set to `undefined`. */
const detectedFrom = (scan: WorkspaceScan, ctx: DetectionContext): DetectedFields => {
  const packages = buildProposalPackages(
    scan.packages,
    ctx.resolved.npmDirectory,
    ctx.resolved.npmPkgName,
  );
  const rootPackageName = registeredRootName(scan.packages, packages);
  const detectionWarning = detectionWarningFor(scan);
  return {
    defaultBranch: ctx.defaultBranch,
    ...(detectionWarning === undefined ? {} : { detectionWarning }),
    packages,
    ...(rootPackageName === undefined ? {} : { rootPackageName }),
    tagFormatCandidate: ctx.tagFormatCandidate,
  };
};

/** The format most of the repository's tags use — or `null`, when the tag list could not be read
 * whole.
 *
 * Counting is a claim about every tag, so a partial list cannot support it: a repository whose tag
 * output hit the stream cap would otherwise get a candidate derived from whichever prefix happened
 * to survive. `null` is the same answer a repository with no usable tags gets, and `refs tag`
 * already reports the absence rather than inventing a convention. */
const tagCandidateFrom = (tagged: { complete: boolean; tags: string[] }): TagFormat | null =>
  // eslint-disable-next-line unicorn/no-null -- matches `detectTagFormat`'s own `TagFormat | null`
  tagged.complete ? detectTagFormat(tagged.tags) : null;

const detectProposalFields = async (
  ctx: CliContext,
  dest: string,
  resolved: ResolvedSource,
): Promise<DetectedFields> => {
  const defaultBranch = await detectDefaultBranch(ctx.runner, dest);
  const tagged = await listTags(ctx.runner, dest);
  const tagFormatCandidate = tagCandidateFrom(tagged);
  progress(ctx, 'detecting workspace packages…');
  const scan = await detectWorkspacePackagesDetailed(dest);
  return detectedFrom(scan, { defaultBranch, resolved, tagFormatCandidate });
};

type CloneAndDetectOpts = {
  cloneMode: CloneMode;
  dest: string;
  home: RefsHome;
  resolved: ResolvedSource;
};

type CloneAndDetectResult = {
  effectiveMode?: CloneMode;
  fields: DetectedFields;
  warning?: string;
};

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

type BuildDryRunOutcomeOpts = {
  cloneResult: CloneAndDetectResult;
  dest: string;
  resolved: ResolvedSource;
};

/** The serialized half: what a `--proposal` file carries. `description` starts empty — it is the
 * one field a human or an agent must supply. */
const proposalFrom = (fields: DetectedFields, resolved: ResolvedSource): Proposal => ({
  default_branch: fields.defaultBranch,
  description: '',
  key: resolved.key,
  packages: fields.packages,
  tag_format_candidate: fields.tagFormatCandidate,
  url: resolved.cloneUrl,
});

/** Assembled in one expression, with the same conditional-spread idiom `detectedFrom` uses above:
 * `exactOptionalPropertyTypes` distinguishes an absent key from one set to `undefined`, and all
 * four of these are genuinely absent most of the time. */
const buildDryRunOutcome = (opts: BuildDryRunOutcomeOpts): DryRunOutcome => {
  const { effectiveMode, fields, warning } = opts.cloneResult;
  return {
    dest: opts.dest,
    proposal: proposalFrom(fields, opts.resolved),
    ...(fields.detectionWarning === undefined ? {} : { detectionWarning: fields.detectionWarning }),
    ...(fields.rootPackageName === undefined ? {} : { rootPackageName: fields.rootPackageName }),
    ...(effectiveMode === undefined ? {} : { effectiveCloneMode: effectiveMode }),
    ...(warning === undefined ? {} : { warning }),
  };
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
 * `--description` finalizes it (see `finalizeRef` in `add-finalize.ts`). Also persists
 * `effectiveCloneMode` when this dry-run actually cloned (see `ensureClonedCheckout`'s
 * partial-clone-fallback note) so a later `--proposal` finalize — which never re-clones — can
 * recover the real mode used instead of silently guessing the global default.
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

export { runDryRunCore, tagCandidateFrom, writePendingProposal };
export type { DryRunOutcome };
