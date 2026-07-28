import {
  buildFinalPackages,
  finalProposalPackages,
  requireAllDescribed,
  requireTagFormat,
} from './add-packages.ts';
import {
  checkoutPath,
  isGitCheckout,
  notFoundError,
  resolveHome,
  usageError,
} from '@kaisers-io/refs-core';
import { emit, wrapAction } from '../output.ts';
import { runDryRunCore, toWarningsList, writePendingProposal } from './add-dry-run.ts';
import type { CliContext } from '../context.ts';
import type { DryRunOutcome } from './add-dry-run.ts';
import type { FinalProposal } from '@kaisers-io/refs-core';
import type { FinalizeOpts } from './add-finalize.ts';
import type { FinalizedRefInput } from './add-packages.ts';
import type { RefsCommand } from './registry.ts';
import { finalizeRef } from './add-finalize.ts';
import { loadFinalProposal } from './add-proposal-io.ts';

// `refs add` — the two-phase flow (`--dry-run` proposes, `--proposal` finalizes) plus the
// `--description` one-shot convenience. Source resolution/guards live in `add-helpers.ts`, the
// dry-run pipeline in `add-dry-run.ts`, package/proposal shaping in `add-packages.ts`,
// proposal-file/stdin loading in `add-proposal-io.ts`, and the finalize write path in
// `add-finalize.ts` — split out to keep this file under the repo's 300-line oxlint cap.

const NO_ACTIVE_MODES = 0;
const MIN_ACTIVE_MODES = 1;

interface AddOutcome {
  data: unknown;
  human: string[];
  warnings: string[];
}

const dryRunHuman = (key: string, dest: string): string[] => [
  `refs add: dry-run proposal ready for '${key}' (checkout: ${dest})`,
  'next: review the proposal, then run refs add --proposal <file> to finalize',
];

const runAddDryRun = async (ctx: CliContext, source: string): Promise<AddOutcome> => {
  const outcome = await runDryRunCore(ctx, source);
  const home = resolveHome(ctx.env);
  await writePendingProposal(home, outcome.proposal.key, outcome.effectiveCloneMode);
  const warnings = toWarningsList(outcome.warning);
  return {
    data: outcome.proposal,
    human: dryRunHuman(outcome.proposal.key, outcome.dest),
    warnings,
  };
};

const finalizeHuman = (key: string): string[] => [`refs add: '${key}' added to config`];

const buildProposalRef = (finalProposal: FinalProposal): FinalizedRefInput => {
  const ref: FinalizedRefInput = {
    default_branch: finalProposal.default_branch,
    description: finalProposal.description,
    key: finalProposal.key,
    tag_format: requireTagFormat(finalProposal.tag_format_candidate),
    url: finalProposal.url,
  };
  const packages = finalProposalPackages(finalProposal.packages);
  if (packages !== undefined) {
    ref.packages = packages;
  }
  return ref;
};

const runAddProposal = async (ctx: CliContext, location: string): Promise<AddOutcome> => {
  const finalProposal = await loadFinalProposal(ctx, location);
  const home = resolveHome(ctx.env);
  const dest = checkoutPath(home, finalProposal.key);
  if (!isGitCheckout(dest)) {
    throw notFoundError(`no checkout found at ${dest} — run: refs add <source> --dry-run first`);
  }
  const ref = buildProposalRef(finalProposal);
  const { entry, key } = await finalizeRef(ctx, { dest, home, ref });
  return { data: { entry, key }, human: finalizeHuman(key), warnings: [] };
};

// `requireAllDescribed` runs FIRST, before anything else here (including `requireTagFormat`'s own
// validation) and before `finalizeRef` is ever reached — the one-shot `--description` text is only
// ever the top-level ref's own description, never a per-package fallback (see that function's own
// doc comment), so any package still missing a detected description must fail closed here, with no
// config/state write having happened yet.
const buildDescriptionRef = (outcome: DryRunOutcome, description: string): FinalizedRefInput => {
  requireAllDescribed(outcome.proposal.packages);
  const ref: FinalizedRefInput = {
    default_branch: outcome.proposal.default_branch,
    description,
    key: outcome.proposal.key,
    tag_format: requireTagFormat(outcome.proposal.tag_format_candidate),
    url: outcome.proposal.url,
  };
  const packages = buildFinalPackages(outcome.proposal.packages);
  if (packages !== undefined) {
    ref.packages = packages;
  }
  return ref;
};

const runAddDescription = async (
  ctx: CliContext,
  source: string,
  description: string,
): Promise<AddOutcome> => {
  const outcome = await runDryRunCore(ctx, source);
  const home = resolveHome(ctx.env);
  const ref = buildDescriptionRef(outcome, description);
  const finalizeOpts: FinalizeOpts = { dest: outcome.dest, home, ref };
  if (outcome.effectiveCloneMode !== undefined) {
    finalizeOpts.effectiveCloneMode = outcome.effectiveCloneMode;
  }
  const { entry, key } = await finalizeRef(ctx, finalizeOpts);
  const warnings = toWarningsList(outcome.warning);
  return { data: { entry, key }, human: finalizeHuman(key), warnings };
};

interface AddOptions {
  description?: string;
  dryRun: boolean;
  proposal?: string;
  source?: string;
}

const NEEDS_MODE_MESSAGE = 'refs add needs --dry-run, --proposal, or --description';
const MUTUALLY_EXCLUSIVE_MESSAGE =
  'refs add: use only one of --dry-run, --proposal, or --description';
const REQUIRES_SOURCE_MESSAGE = 'refs add requires <source> (a git url or npm:<package>)';

const assertSingleMode = (opts: AddOptions): void => {
  const activeCount = [
    opts.dryRun,
    opts.proposal !== undefined,
    opts.description !== undefined,
  ].filter(Boolean).length;
  if (activeCount > MIN_ACTIVE_MODES) {
    throw usageError(MUTUALLY_EXCLUSIVE_MESSAGE);
  }
  if (activeCount === NO_ACTIVE_MODES) {
    throw usageError(NEEDS_MODE_MESSAGE);
  }
};

const requireSource = (source: string | undefined): string => {
  if (source === undefined || source === '') {
    throw usageError(REQUIRES_SOURCE_MESSAGE);
  }
  return source;
};

const runAdd = (ctx: CliContext, opts: AddOptions): Promise<AddOutcome> => {
  assertSingleMode(opts);
  if (opts.proposal !== undefined) {
    return runAddProposal(ctx, opts.proposal);
  }
  if (opts.description !== undefined) {
    return runAddDescription(ctx, requireSource(opts.source), opts.description);
  }
  return runAddDryRun(ctx, requireSource(opts.source));
};

// Builds `AddOptions` field-by-field (rather than a single object literal) because
// `exactOptionalPropertyTypes` forbids assigning a `string | undefined` value directly onto an
// optional `string` property — each field is only ever set when its source value is defined.
const buildAddOptions = (
  source: string | undefined,
  localOpts: { description?: string; dryRun?: boolean; proposal?: string },
): AddOptions => {
  const opts: AddOptions = { dryRun: localOpts.dryRun === true };
  if (source !== undefined) {
    opts.source = source;
  }
  if (localOpts.proposal !== undefined) {
    opts.proposal = localOpts.proposal;
  }
  if (localOpts.description !== undefined) {
    opts.description = localOpts.description;
  }
  return opts;
};

const registerAdd = (program: RefsCommand, ctx: CliContext): void => {
  program
    .command('add')
    .description(
      'Add a git reference in two phases: propose (--dry-run), then finalize (--proposal).',
    )
    .argument('[source]', 'git url or npm:<package> (omit when finalizing with --proposal)')
    .option('--dry-run', 'resolve and clone the source, writing a reviewable proposal')
    .option('--proposal <file>', 'finalize from a completed proposal JSON file (- for stdin)')
    .option(
      '--description <text>',
      'one-shot: dry-run then finalize immediately with this description',
    )
    .action((source, localOpts, command) => {
      const globals = command.optsWithGlobals();
      const opts = { json: globals.json === true, verbose: globals.verbose === true };
      return wrapAction(ctx, opts, async () => {
        const outcome = await runAdd(ctx, buildAddOptions(source, localOpts));
        emit(ctx, opts, outcome.human, outcome.data, outcome.warnings);
      })();
    });
};

export { registerAdd, runAdd };
export type { AddOutcome };
