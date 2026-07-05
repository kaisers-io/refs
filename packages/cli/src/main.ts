import { Command, CommanderError } from '@commander-js/extra-typings';
import { EXIT, renderError } from '@kaisers-io/refs-core';
import type { CliContext } from './context.ts';
import { emitError } from './output.ts';
// eslint-disable-next-line import/no-relative-parent-imports -- package.json lives at the package root, one level above src/
import pkg from '../package.json' with { type: 'json' };
import { registerCommands } from './commands/registry.ts';

const HELP_TEXT_AFTER = [
  '',
  'Examples:',
  '  $ refs list --json',
  '  $ refs sync --stale-only --json',
  '  $ refs resolve next/navigation --json',
  '',
  'Every command accepts --json for structured output and --verbose for stack traces on error.',
].join('\n');

// Commander CommanderError codes that represent a successful, intentional early exit (help or
// Version text was requested and already printed) rather than a failure — these must never be
// Routed through `emitError`.
const SUCCESSFUL_EXIT_CODES = new Set([
  'commander.help',
  'commander.helpDisplayed',
  'commander.version',
]);

const JSON_FLAG = '--json';
const VERBOSE_FLAG = '--verbose';
const ARGV_TERMINATOR = '--';

const TRAILING_NEWLINE_PATTERN = /\n$/u;
const ERROR_PREFIX_PATTERN = /^error: /u;

// Commander argument/option-parsing failures always prefix `message` with `error: ` (baked in by
// `Command#error`) — stripped here so the human line reads `refs: unknown option '--x'` instead
// Of the doubled-up `refs: error: unknown option '--x'`.
const stripCommanderPrefix = (message: string): string => message.replace(ERROR_PREFIX_PATTERN, '');

// Detects a global flag (`--json`/`--verbose`) ahead of parsing so a parse-time failure (unknown
// Option, missing argument, excess arguments, ...) can still be reported through the right
// Renderer even though parsing itself never completed far enough to populate `program.opts()`.
// Scans only tokens BEFORE the first `--` terminator — once Commander sees a bare `--`, every
// Token after it is a literal operand, never an option, so `refs -- --json` must not flip this to
// True just because the substring `--json` occurs somewhere in argv.
const hasGlobalFlag = (argv: readonly string[], flag: string): boolean => {
  for (const token of argv) {
    if (token === ARGV_TERMINATOR) {
      return false;
    }
    if (token === flag) {
      return true;
    }
  }
  return false;
};

const isJsonMode = (argv: readonly string[]): boolean => hasGlobalFlag(argv, JSON_FLAG);

const isVerboseMode = (argv: readonly string[]): boolean => hasGlobalFlag(argv, VERBOSE_FLAG);

// Mirrors `@kaisers-io/refs-core`'s own (unexported) stack-appending rule for `RefsError`s: append
// The stack only when `--verbose` was requested and a stack actually exists. Kept local to this
// Module because `CommanderError` isn't a `RefsError` and never flows through `renderError`.
const appendStackWhenVerbose = (
  message: string,
  stack: string | undefined,
  verbose: boolean,
): string => {
  if (verbose && stack !== undefined) {
    return `${message}\n${stack}`;
  }
  return message;
};

const buildProgram = (ctx: CliContext): Command => {
  const program = new Command()
    .name('refs')
    .description('Manage git-based reference checkouts shared across a workspace.')
    .version(pkg.version)
    .option(JSON_FLAG, 'emit machine-readable JSON on stdout instead of human-readable text')
    .option(VERBOSE_FLAG, 'include stack traces in error output')
    // Explicit even though it mirrors Commander's own default: with the registry empty (Task
    // 15+ adds commands) a stray positional at the root — e.g. `refs status` — must still raise
    // `commander.excessArguments` and flow through the usual usage-error envelope rather than be
    // silently accepted, per the CLI's "usage errors exit 2" contract.
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({
      outputError: () => {
        // Suppressed: `run`/`runProgram` print the single canonical error line themselves (via
        // `emitError`, human or json) — letting Commander's own default formatting through here
        // would print the same failure twice.
      },
      writeErr: (str: string) => {
        ctx.errLine(str.replace(TRAILING_NEWLINE_PATTERN, ''));
      },
      writeOut: (str: string) => {
        ctx.out(str.replace(TRAILING_NEWLINE_PATTERN, ''));
      },
    });
  program.addHelpText('after', HELP_TEXT_AFTER);
  registerCommands(program, ctx);
  return program;
};

// A help/version CommanderError isn't a failure — the text was already written via
// `configureOutput`'s `writeOut`; all that's left is a clean exit.
const finishSuccessfulExit = (): void => {
  process.exitCode = EXIT.OK;
};

// Every other CommanderError (unknown option, missing argument, excess arguments, ...) is a
// Usage error: render it through the same envelope every other command failure uses. `verbose`
// Is honored here too (finding 3) — a `CommanderError` carries its own real stack, so `--verbose`
// Surfaces it exactly like it would for a thrown `RefsError`.
const emitCommanderFailure = (
  ctx: CliContext,
  opts: { json: boolean; verbose: boolean },
  error: CommanderError,
): void => {
  const message = appendStackWhenVerbose(
    stripCommanderPrefix(error.message),
    error.stack,
    opts.verbose,
  );
  const rendered = { code: 'usage', message };
  emitError(ctx, opts, rendered);
  process.exitCode = EXIT.USAGE;
};

const handleCommanderError = (
  ctx: CliContext,
  opts: { json: boolean; verbose: boolean },
  error: CommanderError,
): void => {
  if (SUCCESSFUL_EXIT_CODES.has(error.code)) {
    finishSuccessfulExit();
    return;
  }
  emitCommanderFailure(ctx, opts, error);
};

// A non-Commander error means an action handler threw (a `RefsError` or something unexpected) —
// `renderError` maps it the same way every other command's `wrapAction` catch block does. Verbose
// Is derived pre-parse (finding 3) instead of hardcoded, so `--verbose` reaches this path too.
const handleUnexpectedError = (
  ctx: CliContext,
  opts: { json: boolean; verbose: boolean },
  error: unknown,
): void => {
  const rendered = renderError(error, { verbose: opts.verbose });
  emitError(ctx, opts, rendered);
  process.exitCode = rendered.exitCode;
};

// Shared by `run` and by tests that need to drive a program built (and optionally extended)
// Outside of `buildProgram`'s own wiring — e.g. to exercise a Commander parsing failure class
// (missing argument) that has no reachable command yet in this scaffold.
const runProgram = async (
  ctx: CliContext,
  program: Command,
  argv: readonly string[],
): Promise<void> => {
  const opts = { json: isJsonMode(argv), verbose: isVerboseMode(argv) };
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      handleCommanderError(ctx, opts, error);
      return;
    }
    handleUnexpectedError(ctx, opts, error);
  }
};

const run = (ctx: CliContext, argv: readonly string[]): Promise<void> =>
  runProgram(ctx, buildProgram(ctx), argv);

export { buildProgram, run, runProgram };
