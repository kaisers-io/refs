import { cliOptsOf, emit, wrapAction } from '../output.ts';
import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
import { createPackageEntry } from './edit-package.ts';
import { runEditRef } from './edit-ref.ts';
import { runEditSettings } from './edit-settings.ts';
import { usageError } from '@kaisers-io/refs-core';

// `refs edit` mutates exactly one field, under three modes:
//   - `refs edit settings <key> <value>`               — a global setting (edit-settings.ts)
//   - `refs edit <ref> <field> <value>`                 — a top-level ref field (edit-ref.ts)
//   - `refs edit <ref> <field> <value> --package <name>` — a package field (edit-ref.ts delegates
//     to edit-package.ts)
//   - `refs edit <ref> --package <name> --create --path <p> --description <d>` — registers a
//     package the config did not have (edit-package.ts)
//
// The two positional arguments after `<ref>` are optional ONLY so `--create` can carry its two
// fields as flags: a creation needs `path` and `description` together, and the positional form
// takes exactly one field and one value. They stay required in every other mode, enforced here
// rather than by commander (`missingFieldMessage`).
//
// Design note — 'settings' vs. `<ref>` dispatch: both forms take exactly THREE positional
// arguments after `edit`, so this registers ONE commander command with three fixed `<arg>`
// positions and dispatches on whether the FIRST one is the literal string `'settings'`, rather
// than registering `edit settings` as a distinct subcommand alongside a bare `edit <ref>` — two
// separate commander commands would need a fallback/catch-all to keep `refs edit <ref> ...`
// working at all (commander has no built-in "subcommand OR positional" construction), and would
// double the plumbing (two `.action`s, two option definitions) for no behavioral gain. The
// one-command-plus-string-check approach keeps `refs edit --help` a single, clean usage line and
// needs no fallback machinery.
//
// This makes 'settings' a reserved word for the FIRST argument: a ref named literally 'settings'
// can never occur as a full ref key (`zRefKey` requires `host/path…/repo`, at least one `/`, so no
// full key is ever the bare string 'settings'), but a ref whose LAST segment happens to be
// 'settings' (e.g. `github.com/acme/settings`) cannot be addressed by that one-segment suffix —
// `refs edit settings ...` always dispatches to settings mode first. Reaching such a ref still
// works via a longer suffix (`acme/settings`) or its full key, both of which are never equal to
// the bare word 'settings' and so never collide with the reserved dispatch check.
//
// That said, this IS a real silent-wrong-target risk: `refs edit settings sync_ttl 2h` looks
// exactly as valid whether or not the user actually meant the ref suffixed `.../settings`, and
// nothing about the command's shape signals which document got mutated;
// edit-settings.ts#collisionWarnings makes that case loud by appending a 'note:' warning naming
// the shadowed ref.

type EditData = {
  /** Present only on `--create`, where `old` is null and `new` is the whole new entry — the one
   * mode whose human line is a registration rather than a field transition. */
  created?: boolean;
  field: string;
  key: string;
  new: unknown;
  old: unknown;
};

type EditOptions = {
  packageName?: string;
};

type CreateOptions = {
  create?: boolean;
  description?: string;
  path?: string;
};

type EditResult = {
  data: EditData;
  warnings: string[];
};

const SETTINGS_MODE_KEYWORD = 'settings';
const NO_WARNINGS: string[] = [];
const PACKAGE_OPTION_USAGE_MESSAGE =
  "--package is not valid with 'refs edit settings ...' — it only applies to ref/package edits";
const CREATE_USAGE_MESSAGE =
  '--create registers a new package: it needs --package <name>, --path <path> and ' +
  '--description <text>, and takes no <field> <value> arguments';
const CREATE_ONLY_OPTION_MESSAGE =
  '--path and --description only apply to --create — to change one field of a registered ' +
  'package use: refs edit <ref> <field> <value> --package <name>';
const MISSING_FIELD_MESSAGE = "missing <field> and <value> — see 'refs edit --help'";

// `exactOptionalPropertyTypes` forbids assigning a possibly-`undefined` value directly onto an
// optional property — mirrors `add.ts`'s `buildAddOptions`/`tag.ts`'s `buildTagOptions`.
const buildEditOptions = (localOpts: { package?: string }): EditOptions => {
  const opts: EditOptions = {};
  if (localOpts.package !== undefined) {
    opts.packageName = localOpts.package;
  }
  return opts;
};

type EditArgs = {
  create: CreateOptions;
  first: string;
  opts: EditOptions;
  // Explicitly `| undefined`: commander always passes both positionals, as `undefined` when they
  // were not given, and `exactOptionalPropertyTypes` distinguishes that from an absent property.
  second: string | undefined;
  value: string | undefined;
};

/** `--create`'s four requirements, checked together so a partial invocation names everything that
 * is missing at once rather than one flag per attempt. The positional check is part of it: with
 * `<field> <value>` present the caller has written two mutually exclusive forms, and guessing
 * which one they meant is how a field edit turns into a silent registration. */
const requireCreateShape = (
  args: EditArgs,
): { description: string; packageName: string; path: string } => {
  const { description, path } = args.create;
  const { packageName } = args.opts;
  if (
    packageName === undefined ||
    description === undefined ||
    path === undefined ||
    args.second !== undefined ||
    args.value !== undefined
  ) {
    throw usageError(CREATE_USAGE_MESSAGE);
  }
  return { description, packageName, path };
};

/** The positional pair every non-`--create` mode still requires. Commander enforced this when the
 * arguments were declared `<field> <value>`; they are `[field] [value]` now, so it is enforced
 * here for exactly the modes that did not opt out of it. */
const requireFieldAndValue = (args: EditArgs): { field: string; value: string } => {
  if (args.second === undefined || args.value === undefined) {
    throw usageError(MISSING_FIELD_MESSAGE);
  }
  return { field: args.second, value: args.value };
};

const runCreate = async (ctx: CliContext, args: EditArgs): Promise<EditResult> => {
  const { description, packageName, path } = requireCreateShape(args);
  const data = await createPackageEntry(ctx, {
    description,
    packageName,
    path,
    query: args.first,
  });
  return { data, warnings: NO_WARNINGS };
};

const runSettings = (
  ctx: CliContext,
  args: EditArgs,
  setting: { key: string; value: string },
): Promise<EditResult> => {
  if (args.opts.packageName !== undefined) {
    throw usageError(PACKAGE_OPTION_USAGE_MESSAGE);
  }
  return runEditSettings(ctx, setting);
};

const runEdit = async (ctx: CliContext, args: EditArgs): Promise<EditResult> => {
  if (args.create.create === true) {
    return runCreate(ctx, args);
  }
  if (args.create.description !== undefined || args.create.path !== undefined) {
    throw usageError(CREATE_ONLY_OPTION_MESSAGE);
  }
  const { field, value } = requireFieldAndValue(args);
  if (args.first === SETTINGS_MODE_KEYWORD) {
    return runSettings(ctx, args, { key: field, value });
  }
  const data = await runEditRef(ctx, {
    field,
    opts: args.opts,
    query: args.first,
    value,
  });
  return { data, warnings: NO_WARNINGS };
};

const UNSET_DISPLAY = '(unset)';

// `EditData.old`/`.new` are normalized to `null` (never `undefined`) before this ever sees them
// (`edit-envelope.ts`'s `normalizeEditValue`) — this only has to render that `null` (an unset
// optional field) as something more legible than the literal string `'null'`.
const formatEditValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return UNSET_DISPLAY;
  }
  return String(value);
};

/** The shape `--create` puts in `EditData.new` — the whole registered entry, not one field's
 * value, which is why it needs a line of its own rather than `formatEditValue`. */
type CreatedEntry = { description: string; name: string; path: string };

const editHuman = (data: EditData): string[] => {
  if (data.created === true) {
    const created = data.new as CreatedEntry;
    return [`${data.key}: registered '${created.name}' at ${created.path}`];
  }
  return [
    `${data.key}: ${data.field} '${formatEditValue(data.old)}' -> '${formatEditValue(data.new)}'`,
  ];
};

const registerEdit = (program: RefsCommand, ctx: CliContext): void => {
  program
    .command('edit')
    .description(
      "Edit one field: 'refs edit settings <key> <value>' for a global setting, or " +
        "'refs edit <ref> <field> <value> [--package <name>]' for a ref or package field. " +
        'With --create, registers a package the config does not have yet.',
    )
    .argument('<ref-or-settings>', "a ref key/unique suffix, or the literal 'settings'")
    .argument('[field-or-key]', 'field to edit (or, in settings mode, the setting key)')
    .argument('[value]', 'the new value')
    .option('--package <name>', "edit this package's field instead of a top-level ref field")
    .option('--create', 'register --package as a new package on this ref')
    .option('--path <path>', 'with --create: the package path, relative to the checkout root')
    .option('--description <text>', 'with --create: what the package is')
    // eslint-disable-next-line max-params -- fixed 5-arg shape commander gives a 3-argument command
    .action((first, second, value, localOpts, command) => {
      const opts = cliOptsOf(command);
      return wrapAction(ctx, opts, async () => {
        const { data, warnings } = await runEdit(ctx, {
          create: localOpts,
          first,
          opts: buildEditOptions(localOpts),
          second,
          value,
        });
        emit(ctx, opts, editHuman(data), data, warnings);
      })();
    });
};

export { registerEdit };
export type { EditData };
