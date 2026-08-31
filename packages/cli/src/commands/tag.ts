import type { RefEntry, RefKey } from '@kaisers-io/refs-core';
import {
  checkoutPath,
  readConfig,
  resolveHome,
  resolveTag,
  validationError,
} from '@kaisers-io/refs-core';
import { cliOptsOf, emit, wrapAction } from '../output.ts';
import { requireCheckout, requireEntry, requirePackage } from './ref-context.ts';
import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
import { matchRefKey } from './list.ts';
import { shellQuote } from '../shell-quote.ts';

// `refs tag <ref> <version> [--package <name>]` — resolves a semver-ish `<version>` to the actual
// git tag it corresponds to, by rendering the applicable `tag_format` and verifying the rendered
// tag exists in the ref's checkout (core's `resolveTag`, itself built on `tagExists`/`renderTag`).
// `--package <name>` targets one of the ref's registered packages instead of the ref itself; its
// `tag_format` inherits the ref's own when the package does not override one:
// `package.tag_format ?? ref.tag_format`. An unresolvable `--package` name is a `notFoundError`,
// exactly like an unresolvable `<ref>` is (via `matchRefKey`).

type TagData = {
  key: string;
  ref_path: string;
  tag: string;
  version: string;
};

type TagOptions = {
  packageName?: string;
};

type TagArgs = {
  opts: TagOptions;
  query: string;
  version: string;
};

/** Resolves the `tag_format` to render `version` against: the named package's own override when
 * `packageName` is given and it has one, else the ref's own `tag_format`. An unregistered
 * `packageName` is a `notFoundError`, not a silent ref-level
 * fallback. Either level may be absent — see `requireFormat`. */
const formatFor = (
  entry: RefEntry,
  key: RefKey,
  packageName: string | undefined,
): string | undefined => {
  if (packageName === undefined) {
    return entry.tag_format;
  }
  return requirePackage(entry, key, packageName).tag_format ?? entry.tag_format;
};

/** A ref (or package) with no `tag_format` is configured, just not for this: nothing maps a version
 * onto a tag name. That is a `validationError` (exit 3) rather than `notFoundError` (exit 4), which
 * stays reserved for a ref, package, checkout or rendered tag that genuinely does not exist —
 * the caller can tell "this ref cannot resolve versions at all" from "that version was never
 * tagged". */
const requireFormat = (
  format: string | undefined,
  key: RefKey,
  packageName: string | undefined,
): string => {
  if (format !== undefined) {
    return format;
  }
  // The suggested fix has to target the level that failed. A package resolving to nothing must be
  // fixed with `--package`: setting the ref-level format instead would hand that convention to
  // every other package that has no override of its own.
  const subject = packageName === undefined ? `ref '${key}'` : `package '${packageName}'`;
  const scope = packageName === undefined ? '' : ` --package ${shellQuote(packageName)}`;
  throw validationError(
    `${subject} has no tag_format configured — inspect the repository's real tags and set one ` +
      `with: refs edit ${shellQuote(key)} tag_format '<format>'${scope}`,
  );
};

const runTag = async (ctx: CliContext, args: TagArgs): Promise<TagData> => {
  const home = resolveHome(ctx.env);
  const config = await readConfig(home);
  const key = matchRefKey(config, args.query);
  const entry = requireEntry(config, key);
  // Before touching the checkout: a missing format is a configuration answer, not a git one.
  const format = requireFormat(
    formatFor(entry, key, args.opts.packageName),
    key,
    args.opts.packageName,
  );
  const dest = checkoutPath(home, key);
  requireCheckout(dest, key);
  const tag = await resolveTag(ctx.runner, dest, format, args.version);
  return { key, ref_path: `refs/tags/${tag}`, tag, version: args.version };
};

const tagHuman = (data: TagData): string[] => [`${data.key}@${data.version} -> ${data.tag}`];

// `exactOptionalPropertyTypes` forbids assigning a possibly-`undefined` value directly onto an
// optional property — mirrors `add.ts`'s `buildAddOptions`.
const buildTagOptions = (localOpts: { package?: string }): TagOptions => {
  const opts: TagOptions = {};
  if (localOpts.package !== undefined) {
    opts.packageName = localOpts.package;
  }
  return opts;
};

const registerTag = (program: RefsCommand, ctx: CliContext): void => {
  program
    .command('tag')
    .description("Resolve a version to its git tag, via the ref's (or a package's) tag_format.")
    .argument('<ref>', 'full ref key or a unique suffix, e.g. zod')
    .argument('<version>', 'version to resolve, e.g. 4.1.0')
    .option('--package <name>', "resolve against this package's tag_format instead of the ref's")
    // eslint-disable-next-line max-params -- fixed 4-arg shape commander gives a 2-argument command
    .action((ref, version, localOpts, command) => {
      const opts = cliOptsOf(command);
      return wrapAction(ctx, opts, async () => {
        const data = await runTag(ctx, { opts: buildTagOptions(localOpts), query: ref, version });
        emit(ctx, opts, tagHuman(data), data);
      })();
    });
};

export { registerTag };
