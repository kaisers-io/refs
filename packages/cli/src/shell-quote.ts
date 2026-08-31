// POSIX single-quoting for values that end up inside a command someone is meant to paste into a
// shell.
//
// This is not cosmetic. Ref keys are derived from urls the user supplies, and `SAFE_SEGMENT`
// (`packages/core/src/schemas/primitives.ts`) rejects only separators, `.`/`..` segments, percent
// escapes and colons — spaces, `$()`, backticks, semicolons and quotes are all permitted. Package
// names come from a tracked repository's own workspace manifests and are checked only for being
// non-empty and not a prototype key. And the refs home itself routinely sits under a path with a
// space in it. An unquoted value in a suggested command is therefore an execution primitive at
// worst, and a command that silently operates on the wrong paths at best.

/** Single-quotes `value` for a shell, closing and reopening the quote around any embedded `'`. */
const shellQuote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;

/** A `rm -rf` a human or agent can paste as-is. `--` ends the option list, so a path beginning with
 * `-` is treated as a path rather than parsed as flags. */
const rmCommand = (path: string): string => `rm -rf -- ${shellQuote(path)}`;

export { rmCommand, shellQuote };
