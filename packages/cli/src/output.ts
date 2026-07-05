import type { CliContext } from './context.ts';
import { renderError } from '@kaisers-io/refs-core';

// The two shapes every command reply takes on stdout in `--json` mode. Kept as types (not
// Exported) so the envelope stays an implementation detail of `emit`/`emitError` — callers pass
// Plain data, never construct the envelope themselves.
interface SuccessEnvelope {
  data: unknown;
  ok: true;
  warnings: string[];
}

interface ErrorEnvelope {
  error: { code: string; message: string };
  ok: false;
}

const NO_WARNINGS: string[] = [];

// Normalizes `emit`'s `human` parameter (one line, or several) to an array — kept out of `emit`
// Itself only to avoid a ternary there (repo style forbids `no-ternary`).
const toLines = (human: string | string[]): string[] => {
  if (Array.isArray(human)) {
    return human;
  }
  return [human];
};

// Human mode prints one line per element of `human` (a single string is treated as one line) to
// Stdout, then — if `warnings` is non-empty — each warning as its own `refs: warning: <warning>`
// Line on stderr, mirroring `emitError`'s `refs: <message>` prefix convention. Warnings go to
// Stderr rather than stdout so scripts piping a command's human-mode stdout stay clean/parseable
// Even when a warning fires. Json mode instead prints exactly one `JSON.stringify`d envelope line
// On stdout, with `data`/`warnings` folded into that envelope and nothing written to stderr.
// eslint-disable-next-line max-params -- fixed 5-arg contract shape mandated by the CLI spec (ctx, opts, human, data, warnings)
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
// Error envelope to STDOUT (not stderr) — agents parsing `--json` output only ever need to read
// One stream, success or failure.
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

// Shared action wrapper for every `registerX` command: run the pure action body, and on any
// Thrown error (a `RefsError` or otherwise) render it, emit the envelope, and set the process
// Exit code — exactly once, right here. Command actions themselves never touch `process` or
// Catch their own errors; that's this function's job alone.
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

export { emit, emitError, wrapAction };
