import type { CliContext } from './context.ts';
import { renderError } from '@kaisers-io/refs-core';

// The two shapes every command reply takes on stdout in `--json` mode. Kept as types (not
// exported) so the envelope stays an implementation detail of `emit`/`emitError` — callers pass
// plain data, never construct the envelope themselves.
type SuccessEnvelope = {
  data: unknown;
  ok: true;
  warnings: string[];
};

type ErrorEnvelope = {
  error: { code: string; message: string };
  ok: false;
};

const NO_WARNINGS: string[] = [];

// Normalizes `emit`'s `human` parameter (one line, or several) to an array.
const toLines = (human: string | string[]): string[] => (Array.isArray(human) ? human : [human]);

// Normalizes a command's optional single warning to `emit`'s warnings array.
const warningsFor = (warning: string | undefined): string[] =>
  warning === undefined ? NO_WARNINGS : [warning];

// Renders a caught `unknown` as a plain message string: an `Error`'s own `.message`, anything else
// via `String(...)`. The CLI-side twin of core's private helper of the same name in
// `proc/runner.ts` (core stays self-contained, so it is not imported from there).
const errorMessageOf = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

// Reads the inherited `--json`/`--verbose` globals off a registrar's commander `command` and
// normalizes both to definite booleans (absent → false). Structurally typed — only the
// `optsWithGlobals` shape, never a commander import — so this module stays commander-free.
const cliOptsOf = (command: {
  optsWithGlobals: () => { json?: boolean; verbose?: boolean };
}): { json: boolean; verbose: boolean } => {
  const globals = command.optsWithGlobals();
  return { json: globals.json === true, verbose: globals.verbose === true };
};

// Human mode prints one line per element of `human` (a single string is treated as one line) to
// stdout, then — if `warnings` is non-empty — each warning as its own `refs: warning: <warning>`
// line on stderr, mirroring `emitError`'s `refs: <message>` prefix convention. Warnings go to
// stderr rather than stdout so scripts piping a command's human-mode stdout stay clean/parseable
// even when a warning fires. Json mode instead prints exactly one `JSON.stringify`d envelope line
// on stdout, with `data`/`warnings` folded into that envelope and nothing written to stderr.
// eslint-disable-next-line max-params -- (ctx, opts, human, data, warnings?): the trailing optional would only move into a wrapper object, obscuring the dominant 4-arg call shape
const emit = (
  ctx: CliContext,
  opts: { json: boolean },
  human: string | string[],
  data: unknown,
  warnings?: string[],
): void => {
  if (opts.json) {
    const envelope: SuccessEnvelope = { data, ok: true, warnings: warnings ?? NO_WARNINGS };
    ctx.out(JSON.stringify(envelope));
    return;
  }
  for (const line of toLines(human)) {
    ctx.out(line);
  }
  for (const warning of warnings ?? NO_WARNINGS) {
    ctx.errLine(`refs: warning: ${warning}`);
  }
};

// Human mode writes a single `refs: <message>` line to stderr. Json mode instead writes the
// error envelope to STDOUT (not stderr) — agents parsing `--json` output only ever need to read
// one stream, success or failure.
const emitError = (
  ctx: CliContext,
  opts: { json: boolean },
  rendered: { code: string; message: string },
): void => {
  if (opts.json) {
    const envelope: ErrorEnvelope = {
      error: { code: rendered.code, message: rendered.message },
      ok: false,
    };
    ctx.out(JSON.stringify(envelope));
    return;
  }
  ctx.errLine(`refs: ${rendered.message}`);
};

// A short, unconditional `refs: <message>` progress line to stderr — fires in BOTH `--json` and
// human mode (unlike `emit`'s warnings, which only reach stderr in human mode; json warnings fold
// into the final envelope instead). Used by long-running steps of `refs add` (npm resolution,
// cloning, package detection) that would otherwise print nothing for minutes. Deliberately dumb:
// no spinner, no TTY detection, no timer — just a line, written as the step starts.
const progress = (ctx: CliContext, message: string): void => {
  ctx.errLine(`refs: ${message}`);
};

// Shared action wrapper for every `registerX` command: run the pure action body, and on any
// thrown error (a `RefsError` or otherwise) render it, emit the envelope, and set the process
// exit code — exactly once, right here. Command actions themselves never touch `process` or
// catch their own errors; that's this function's job alone.
const wrapAction =
  (ctx: CliContext, opts: { json: boolean; verbose: boolean }, action: () => Promise<void>) =>
  async (): Promise<void> => {
    try {
      await action();
    } catch (error) {
      const rendered = renderError(error, { verbose: opts.verbose });
      emitError(ctx, opts, rendered);
      process.exitCode = rendered.exitCode;
    }
  };

export { cliOptsOf, emit, emitError, errorMessageOf, progress, warningsFor, wrapAction };
