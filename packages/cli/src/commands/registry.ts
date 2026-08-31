/* eslint-disable import/max-dependencies -- composition root: this module's whole job is to import
   every command module and list its registrar, so its dependency count is a count of commands, not
   of coupling. Capping it only pushed commands into an overflow file, which taught contributors a
   workaround and moved the cap one file over rather than reducing anything. */
import type { CliContext } from '../context.ts';
import type { Command } from '@commander-js/extra-typings';
import { registerAdd } from './add.ts';
import { registerDoctor } from './doctor.ts';
import { registerEdit } from './edit.ts';
import { registerInit } from './init.ts';
import { registerList } from './list.ts';
import { registerMigrate } from './migrate.ts';
import { registerRemove } from './remove.ts';
import { registerResolve } from './resolve.ts';
import { registerShow } from './show.ts';
import { registerSync } from './sync.ts';
import { registerTag } from './tag.ts';

// The real `--json`/`--verbose` global option shape every command inherits from the root program
// built in `main.ts#buildProgram`. Named here (rather than left for each command module to
// re-derive) so it is defined exactly once. Must stay a type alias (never an `interface`): an
// interface has no implicit index signature, so `Command<[], ..., GlobalCliOptions>` below would
// fail its `GlobalOpts extends OptionValues` (`Record<string, any>`) constraint.
type GlobalCliOptions = { json?: boolean; verbose?: boolean };

// The registrar wiring point's `program` parameter, parameterized with the real inherited-globals
// shape (`GlobalCliOptions`) instead of the bare `Command` type — whose extra-typings generics all
// default to `{}` — so a registrar's `command.optsWithGlobals()` returns `GlobalCliOptions`
// directly and command modules like `init.ts` no longer need an `as unknown` cast to read it.
// `Record<never, never>` — structurally the same empty-object type as extra-typings' own
// `Opts extends OptionValues = {}` default, without the literal `{}` oxlint's `ban-types` rule
// rejects. `Record<string, never>` would NOT work here: its index signature would force every key
// of the `Opts & GlobalOpts` intersection extra-typings computes for subcommands down to `never`.
type RefsCommand = Command<[], Record<never, never>, GlobalCliOptions>;

// The single wiring point: every command module exports a `registerX(program, ctx)` function and
// gets one entry added to this list. `buildProgram` calls `registerCommands` once and nothing else
// in the package touches `program.command(...)` directly.
const REGISTRARS: readonly ((program: RefsCommand, ctx: CliContext) => void)[] = [
  registerInit,
  registerAdd,
  registerEdit,
  registerList,
  registerDoctor,
  registerMigrate,
  registerRemove,
  registerResolve,
  registerShow,
  registerSync,
  registerTag,
];

const registerCommands = (program: RefsCommand, ctx: CliContext): void => {
  for (const register of REGISTRARS) {
    register(program, ctx);
  }
};

export { registerCommands };
export type { GlobalCliOptions, RefsCommand };
