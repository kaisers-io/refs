import { emit, wrapAction } from '../output.ts';
import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
import { runEditRef } from './edit-ref.ts';
import { runEditSettings } from './edit-settings.ts';
import { usageError } from '@kaisers-io/refs-core';

// `refs edit` mutates exactly one field, under three modes:
//   - `refs edit settings <key> <value>`               — a global setting (edit-settings.ts)
//   - `refs edit <ref> <field> <value>`                 — a top-level ref field (edit-ref.ts)
//   - `refs edit <ref> <field> <value> --package <name>` — a package field (edit-ref.ts delegates
//     to edit-package.ts)
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
// That said, this IS a real silent-wrong-target risk: `clone_mode`/`sync_ttl`/`git_transport`
// exist on both `zSettings` and `zRefSettingsOverride`, so `refs edit settings sync_ttl 2h` looks
// exactly as valid whether or not the user actually meant the ref suffixed `.../settings` — nothing
// about the command's shape signals which document got mutated. Rather than change the
// deterministic dispatch (settings always wins — see above), `edit-settings.ts`'s
// `collisionWarnings` fails LOUD-ENOUGH: it re-probes `matchRefKey` for the reserved suffix and, if
// some ref would have matched, appends a `note:` warning to the JSON envelope naming that ref (or,
// for an ambiguous suffix match, naming the situation) so the mistake is visible instead of silent.

type EditData = {
  field: string;
  key: string;
  new: unknown;
  old: unknown;
};

type EditOptions = {
  packageName?: string;
};

type EditResult = {
  data: EditData;
  warnings: string[];
};

const SETTINGS_MODE_KEYWORD = 'settings';
const NO_WARNINGS: string[] = [];
const PACKAGE_OPTION_USAGE_MESSAGE =
  "--package is not valid with 'refs edit settings ...' — it only applies to ref/package edits";

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
  first: string;
  opts: EditOptions;
  second: string;
  value: string;
};

const runEdit = async (ctx: CliContext, args: EditArgs): Promise<EditResult> => {
  if (args.first === SETTINGS_MODE_KEYWORD) {
    if (args.opts.packageName !== undefined) {
      throw usageError(PACKAGE_OPTION_USAGE_MESSAGE);
    }
    return runEditSettings(ctx, { key: args.second, value: args.value });
  }
  const data = await runEditRef(ctx, {
    field: args.second,
    opts: args.opts,
    query: args.first,
    value: args.value,
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

const editHuman = (data: EditData): string[] => [
  `${data.key}: ${data.field} '${formatEditValue(data.old)}' -> '${formatEditValue(data.new)}'`,
];

const registerEdit = (program: RefsCommand, ctx: CliContext): void => {
  program
    .command('edit')
    .description(
      "Edit one field: 'refs edit settings <key> <value>' for a global setting, or " +
        "'refs edit <ref> <field> <value> [--package <name>]' for a ref or package field.",
    )
    .argument('<ref-or-settings>', "a ref key/unique suffix, or the literal 'settings'")
    .argument('<field-or-key>', 'field to edit (or, in settings mode, the setting key)')
    .argument('<value>', 'the new value')
    .option('--package <name>', "edit this package's field instead of a top-level ref field")
    // eslint-disable-next-line max-params -- fixed 5-arg shape commander gives a 3-argument command
    .action((first, second, value, localOpts, command) => {
      const globals = command.optsWithGlobals();
      const opts = { json: globals.json === true, verbose: globals.verbose === true };
      return wrapAction(ctx, opts, async () => {
        const { data, warnings } = await runEdit(ctx, {
          first,
          opts: buildEditOptions(localOpts),
          second,
          value,
        });
        emit(ctx, opts, editHuman(data), data, warnings);
      })();
    });
};

export { registerEdit, runEdit };
export type { EditData };
