import type { RefEntry, RefKey, RefState } from '@kaisers-io/refs-core';
import {
  checkoutPath,
  isGitCheckout,
  listTags,
  readConfig,
  readState,
  resolveHome,
} from '@kaisers-io/refs-core';
import { emit, wrapAction } from '../output.ts';
import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
import { matchRefKey } from './list.ts';
import { requireEntry } from './ref-context.ts';

// `refs show <ref>` — resolves `<ref>` (a full key or unique suffix, via `matchRefKey` in
// `list.ts`) to its full entry, current state, resolved local checkout path, and up to
// `SAMPLE_TAG_LIMIT` recent tags (only when the checkout actually exists).

const SAMPLE_TAG_LIMIT = 5;
const EMPTY_LENGTH = 0;
const EMPTY_STATE: RefState = {};

type ShowData = RefEntry & {
  key: RefKey;
  local_path: string;
  sample_tags: string[];
  state: RefState;
};

const errorDetail = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

type SampleTagsResult = {
  tags: string[];
  warning?: string;
};

// A present checkout can still be broken (corrupt `.git`, detached from its remote, etc.) — `git
// tag` then throws (via core's `runOrThrow` → `validationError`) rather than returning cleanly.
// `refs show` must still succeed in that case: degrade to no sample tags and surface the failure
// as a warning instead of letting it abort the whole command.
const sampleTagsFor = async (ctx: CliContext, dest: string): Promise<SampleTagsResult> => {
  if (!isGitCheckout(dest)) {
    return { tags: [] };
  }
  try {
    const tags = await listTags(ctx.runner, dest, SAMPLE_TAG_LIMIT);
    return { tags };
  } catch (error) {
    return { tags: [], warning: `could not list tags: ${errorDetail(error)}` };
  }
};

type ShowResult = {
  data: ShowData;
  warnings: string[];
};

const NO_WARNINGS: string[] = [];

// Kept out of `runShow` only to avoid a ternary there (repo style forbids `no-ternary`), mirroring
// `output.ts`'s `toLines`.
const warningsFor = (warning: string | undefined): string[] => {
  if (warning === undefined) {
    return NO_WARNINGS;
  }
  return [warning];
};

const runShow = async (ctx: CliContext, query: string): Promise<ShowResult> => {
  const home = resolveHome(ctx.env);
  const config = await readConfig(home);
  const key = matchRefKey(config, query);
  const entry = requireEntry(config, key);
  const state = await readState(home);
  const dest = checkoutPath(home, key);
  const { tags: sampleTags, warning } = await sampleTagsFor(ctx, dest);
  const data: ShowData = {
    ...entry,
    key,
    local_path: dest,
    sample_tags: sampleTags,
    state: state.refs[key] ?? EMPTY_STATE,
  };
  return { data, warnings: warningsFor(warning) };
};

const showHuman = (data: ShowData): string[] => {
  const lines = [
    `${data.key}  ${data.description}`,
    `url: ${data.url}`,
    `local_path: ${data.local_path}`,
  ];
  if (data.sample_tags.length > EMPTY_LENGTH) {
    lines.push(`tags: ${data.sample_tags.join(', ')}`);
  }
  return lines;
};

const registerShow = (program: RefsCommand, ctx: CliContext): void => {
  program
    .command('show')
    .description('Show a configured ref: full entry, state, local path, and sample tags.')
    .argument('<ref>', 'full ref key or a unique suffix, e.g. zod')
    .action((ref, _localOpts, command) => {
      const globals = command.optsWithGlobals();
      const opts = { json: globals.json === true, verbose: globals.verbose === true };
      return wrapAction(ctx, opts, async () => {
        const { data, warnings } = await runShow(ctx, ref);
        emit(ctx, opts, showHuman(data), data, warnings);
      })();
    });
};

export { registerShow, runShow };
export type { ShowData };
