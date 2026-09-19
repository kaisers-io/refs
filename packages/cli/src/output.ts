import type { CliContext } from './context.ts';
import { NO_SPINNER } from './spinner.ts';
import type { Spinner } from './spinner.ts';
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
  error: { code: string; message: string; reason?: string };
  ok: false;
};

const NO_WARNINGS: string[] = [];

// Every control character, including the line terminators: `\p{Cc}` is U+0000–U+001F plus
// U+007F–U+009F. Printable text outside ASCII is deliberately left alone — refs' own lines are
// full of em dashes, and `spinner.ts`'s stricter `[^ -~]` exists there because a spinner label has
// to be one cell per character, which a finished line does not.
const CONTROL_CHARACTER = /\p{Cc}/gu;
// The same, minus LF. An error message is the one place refs composes its own line structure into
// a single string: `refs add`'s two-phase instructions put each command on its own line, and
// `--verbose` appends a stack trace. Flattening those would destroy refs' own output to defend
// against a value that arrives inside it — so the value is neutralised where it enters the message
// instead, and this keeps everything else a control character cannot do.
const CONTROL_CHARACTER_BUT_LF = /[^\P{Cc}\n]/gu;

/** A line whose C0/C1 control characters are neutralised, so a value inside it cannot BE a line.
 *
 * Human lines are composed from values a tracked repository chooses: a workspace member's name is
 * taken from its manifest and interpolated unquoted at the head of every drift finding. A newline
 * in that name produced a second line byte-for-byte indistinguishable from one refs wrote — and
 * the natural payload is a forged `To register it:` clause, because a genuine finding ends in
 * exactly that shape. Line structure has to come from refs alone.
 *
 * `shellQuote` is not this control: it quotes for a shell PARSER, which preserves an embedded
 * newline inside the quotes, and the head of a drift line is not inside a command at all.
 *
 * This is not a general claim that the output cannot be restructured. It covers the lines that
 * pass through here — `emit`'s own and its warnings — and NOT a message that legitimately spans
 * lines, which keeps its `\n` and so neutralises the untrusted values composed INTO that layout at
 * the point they are composed (`requireDescribablePackages` in `add-packages.ts`). `\p{Cc}` is also
 * not every character with line semantics: U+2028, U+2029 and the bidi controls pass through. None
 * of them ends a line for a terminal, which is why the contract is stated as C0/C1 neutralisation.
 *
 * Only the human path needs it. `JSON.stringify` escapes U+0000–U+001F, so the parsed identity of
 * the `--json` envelope was never affected — which is why this does not change that envelope. It
 * does not escape every C1 control, so raw JSON DISPLAYED in a terminal is a separate question
 * from the JSON an agent parses.
 *
 * What a terminal does with an ESC or CSI byte is a property of that terminal and is not claimed
 * here; those bytes are neutralised because they are control characters, not because a specific
 * rendering was observed. */
const displaySafe = (line: string): string => line.replaceAll(CONTROL_CHARACTER, '?');

/** The same for a message that legitimately spans lines. See `CONTROL_CHARACTER_BUT_LF`. */
const displaySafeMessage = (text: string): string => text.replaceAll(CONTROL_CHARACTER_BUT_LF, '?');

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
    ctx.out(displaySafe(line));
  }
  for (const warning of warnings ?? NO_WARNINGS) {
    ctx.errLine(displaySafe(`refs: warning: ${warning}`));
  }
};

// Human mode writes a single `refs: <message>` line to stderr. Json mode instead writes the
// error envelope to STDOUT (not stderr) — agents parsing `--json` output only ever need to read
// one stream, success or failure.
const emitError = (
  ctx: CliContext,
  opts: { json: boolean },
  rendered: { code: string; message: string; reason?: string },
): void => {
  if (opts.json) {
    const envelope: ErrorEnvelope = {
      error: {
        code: rendered.code,
        message: rendered.message,
        // Only where the code alone would be over-read: a `not_found` says a lookup came back
        // empty, and `reason` says which scope was searched. Absent everywhere else rather than
        // filled with a placeholder, so its presence itself carries meaning.
        ...(rendered.reason === undefined ? {} : { reason: rendered.reason }),
      },
      ok: false,
    };
    ctx.out(JSON.stringify(envelope));
    return;
  }
  ctx.errLine(displaySafeMessage(`refs: ${rendered.message}`));
};

// A short, unconditional `refs: <message>` progress line to stderr — fires in BOTH `--json` and
// human mode (unlike `emit`'s warnings, which only reach stderr in human mode; json warnings fold
// into the final envelope instead). Used by long-running steps of `refs add` (npm resolution,
// cloning, package detection) that would otherwise print nothing for minutes. Deliberately dumb:
// no spinner, no TTY detection, no timer — just a line, written as the step starts.
const progress = (ctx: CliContext, message: string): void => {
  // Also in `--json` mode: this one line goes to stderr whatever the mode, so it is the one human
  // line an agent run still prints.
  ctx.errLine(displaySafe(`refs: ${message}`));
};

// Runs a command body with a spinner for a person at a terminal, and stops it however the body
// ends: before the command prints its result, or before `wrapAction` prints the error. `--json`
// gets no spinner at all, whatever stderr is.
const withSpinner = async <TResult>(
  ctx: CliContext,
  opts: { json: boolean },
  work: (spinner: Spinner) => Promise<TResult>,
): Promise<TResult> => {
  const spinner = opts.json ? NO_SPINNER : ctx.spinner();
  try {
    return await work(spinner);
  } finally {
    spinner.stop();
  }
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

export {
  cliOptsOf,
  displaySafe,
  emit,
  emitError,
  errorMessageOf,
  progress,
  warningsFor,
  withSpinner,
  wrapAction,
};
