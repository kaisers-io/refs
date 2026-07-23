import type { CliContext } from '../context.ts';
import type { Command } from '@commander-js/extra-typings';
import { EXTRA_REGISTRARS } from './registrars-extra.ts';
import { MORE_REGISTRARS } from './registrars-more.ts';
import { registerAdd } from './add.ts';
import { registerEdit } from './edit.ts';
import { registerInit } from './init.ts';
import { registerList } from './list.ts';

// The real `--json`/`--verbose` global option shape every command inherits from the root program
// Built in `main.ts#buildProgram`. Named here (rather than left for each command module to
// Re-derive) so it is defined exactly once. Deliberately a `type` alias, not an `interface`: an
// Interface has no implicit index signature, so `Command<[], ..., GlobalCliOptions>` below would
// Fail its `GlobalOpts extends OptionValues` (`Record<string, any>`) constraint — only an object
// Type literal satisfies that check.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- see comment above
type GlobalCliOptions = { json?: boolean; verbose?: boolean };

// The registrar wiring point's `program` parameter, parameterized with the real inherited-globals
// Shape (`GlobalCliOptions`) instead of the bare `Command` type — whose extra-typings generics all
// Default to `{}` — so a registrar's `command.optsWithGlobals()` returns `GlobalCliOptions`
// Directly and command modules like `init.ts` no longer need an `as unknown` cast to read it.
// `Record<never, never>` — structurally the same empty-object type as extra-typings' own
// `Opts extends OptionValues = {}` default, without the literal `{}` oxlint's `ban-types` rule
// Rejects. `Record<string, never>` would NOT work here: its index signature would force every key
// Of the `Opts & GlobalOpts` intersection extra-typings computes for subcommands down to `never`.
type RefsCommand = Command<[], Record<never, never>, GlobalCliOptions>;

// The single wiring point: every command module exports a `registerX(program, ctx)` function and
// Gets one entry added to this list. `buildProgram` calls `registerCommands` once and nothing else
// In the package touches `program.command(...)` directly.
const REGISTRARS: readonly ((program: RefsCommand, ctx: CliContext) => void)[] = [
  registerInit,
  registerAdd,
  registerEdit,
  registerList,
  ...MORE_REGISTRARS,
  ...EXTRA_REGISTRARS,
];

const registerCommands = (program: RefsCommand, ctx: CliContext): void => {
  for (const register of REGISTRARS) {
    register(program, ctx);
  }
};

export { registerCommands };
export type { GlobalCliOptions, RefsCommand };
