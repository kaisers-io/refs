import type { RefEntry, RefKey, RefState } from '@kaisers-io/refs-core';
import {
  checkoutPath,
  isGitCheckout,
  listTags,
  readConfig,
  readState,
  resolveHome,
} from '@kaisers-io/refs-core';
import { cliOptsOf, emit, errorMessageOf, warningsFor, wrapAction } from '../output.ts';
import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
import { matchRefKey } from './list.ts';
import { requireEntry } from './ref-context.ts';

// `refs show <ref>` — resolves `<ref>` (a full key or unique suffix, via `matchRefKey` in
// `list.ts`) to its full entry, current state, resolved local checkout path, and up to
// `SAMPLE_TAG_LIMIT` recent tags (only when the checkout actually exists). In `--json` mode the
// package map and the tag probe are both opt-in, behind `--packages`/`--tags`; human mode is
// unchanged and always probes.

const SAMPLE_TAG_LIMIT = 5;
const EMPTY_STATE: RefState = {};

// `packages` is lifted out of the `RefEntry` spread and re-added only under `--packages`: a
// monorepo entry is up to 90% package descriptions, and every in-repo consumer of `show` reads
// only `local_path`. `sample_tags` is likewise opt-in in json mode — its sole consumer is
// `showHuman`, and producing it costs a `git tag` subprocess.
type ShowData = Omit<RefEntry, 'packages'> & {
  key: RefKey;
  local_path: string;
  packages?: RefEntry['packages'];
  packages_count: number;
  sample_tags?: string[];
  state: RefState;
};

type ShowOptions = {
  packages: boolean;
  tags: boolean;
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
    return { tags: [], warning: `could not list tags: ${errorMessageOf(error)}` };
  }
};

type ShowResult = {
  data: ShowData;
  warnings: string[];
};

const runShow = async (
  ctx: CliContext,
  query: string,
  options: ShowOptions,
): Promise<ShowResult> => {
  const home = resolveHome(ctx.env);
  const config = await readConfig(home);
  const key = matchRefKey(config, query);
  const entry = requireEntry(config, key);
  const state = await readState(home);
  const dest = checkoutPath(home, key);
  const { packages, ...entryWithoutPackages } = entry;
  const sampled = options.tags ? await sampleTagsFor(ctx, dest) : undefined;
  const data: ShowData = {
    ...entryWithoutPackages,
    key,
    local_path: dest,
    ...(options.packages ? { packages: packages ?? {} } : {}),
    packages_count: Object.keys(packages ?? {}).length,
    ...(sampled === undefined ? {} : { sample_tags: sampled.tags }),
    state: state.refs[key] ?? EMPTY_STATE,
  };
  return { data, warnings: warningsFor(sampled?.warning) };
};

const showHuman = (data: ShowData): string[] => {
  const lines = [
    `${data.key}  ${data.description}`,
    `url: ${data.url}`,
    `local_path: ${data.local_path}`,
  ];
  if (data.sample_tags !== undefined && data.sample_tags.length > 0) {
    lines.push(`tags: ${data.sample_tags.join(', ')}`);
  }
  return lines;
};

const registerShow = (program: RefsCommand, ctx: CliContext): void => {
  program
    .command('show')
    .description(
      'Show a configured ref: entry, state, local path, package count; --packages/--tags add the package map and sample tags to --json.',
    )
    .argument('<ref>', 'full ref key or a unique suffix, e.g. zod')
    .option('--packages', "include the ref's full package map in --json output (off by default)")
    .option('--tags', 'include sample tags in --json output (human output always probes for them)')
    .action((ref, localOpts, command) => {
      const opts = cliOptsOf(command);
      return wrapAction(ctx, opts, async () => {
        const showOptions: ShowOptions = {
          packages: localOpts.packages === true,
          // Human output always prints the `tags:` line, so it always needs the probe. Only
          // `--json` mode makes it opt-in — that is where the wasted subprocess showed up.
          tags: !opts.json || localOpts.tags === true,
        };
        const { data, warnings } = await runShow(ctx, ref, showOptions);
        emit(ctx, opts, showHuman(data), data, warnings);
      })();
    });
};

export { registerShow };
export type { ShowData };
