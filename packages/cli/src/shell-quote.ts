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

const CONTROL_CHARACTER = /\p{Cc}/u;
const ANSI_C_ESCAPE = /['\\\p{Cc}]/gu;
const BYTE_HEX_WIDTH = 2;
const HEX_RADIX = 16;
const UTF8 = new TextEncoder();

// `$'…'` is ANSI-C quoting: the shell parses the escapes back to the exact bytes. Verified to
// round-trip identically under bash, zsh and the system `sh`.
//
// It exists here for one case, and only that case is routed through it. A value carrying a control
// character cannot go in ordinary single quotes, because those preserve it: the printed line then
// spans two lines and cannot be pasted, and a display filter that flattens it afterwards silently
// changes which package or path the command names. Encoding is the only spelling that keeps the
// line runnable AND keeps it meaning what it said.
//
// A shell without ANSI-C quoting reads `$'a\x0Ab'` as that literal text, so the command names
// something that does not exist and fails — the safe direction for a value that is hostile by
// construction anyway.
// One `\xNN` per UTF-8 BYTE, not per code point. Two spellings were measured through a real shell
// and rejected: `$'\x9B'` emits the bare byte 0x9B, which is not valid UTF-8 and comes back as
// U+FFFD, and `$'\u009B'` is not understood by the `sh` on macOS, which passes it through as that
// literal text. The byte form is the one every shell tested reads back identically.
const escapedChar = (char: string): string => {
  if (!CONTROL_CHARACTER.test(char)) {
    return `\\${char}`;
  }
  return [...UTF8.encode(char)]
    .map((byte) => `\\x${byte.toString(HEX_RADIX).toUpperCase().padStart(BYTE_HEX_WIDTH, '0')}`)
    .join('');
};

const ansiCQuote = (value: string): string => `$'${value.replaceAll(ANSI_C_ESCAPE, escapedChar)}'`;

/** Single-quotes `value` for a shell, closing and reopening the quote around any embedded `'`. */
const shellQuote = (value: string): string =>
  CONTROL_CHARACTER.test(value)
    ? ansiCQuote(value)
    : `'${value.replaceAll("'", String.raw`'\''`)}'`;

/** `refs edit` as a line that survives BOTH parsers it has to pass.
 *
 * Quoting only gets a value past the shell intact; refs' own option parser reads it next, and a
 * value beginning with `-` is read there as an option. `zPackagePath` admits `-new/pkg` and a ref
 * key may begin with one too, so `refs edit '<key>' path '-new/pkg'` — the obvious spelling —
 * arrives quoted and correct, and exits 2 with `unknown option '-new/pkg'`.
 *
 * Option values are therefore always attached with `=`, which is the only form that keeps a
 * hyphenated value one argument. The `--` terminator, which does the same for positionals, is
 * printed ONLY when a positional needs it: everything after `--` is a positional, so a caller
 * appending `--json` to the printed line — the first thing an agent does — would turn that flag
 * into an argument and the command into `too many arguments`. Paying that cost in every line to
 * cover a path nobody has is the wrong trade; paying it only where a value would otherwise be
 * misread is not.
 *
 * `opts` are rendered by the caller (quoting an option's value is the caller's business, and some
 * take none); `positionals` are quoted here, because every one of them is a value. */
const editCommand = (opts: readonly string[], positionals: readonly string[]): string => {
  const terminator = positionals.some((value) => value.startsWith('-')) ? ['--'] : [];
  return [
    'refs edit',
    ...opts,
    ...terminator,
    ...positionals.map((value) => shellQuote(value)),
  ].join(' ');
};

/** A `rm -rf` a human or agent can paste as-is. `--` ends the option list, so a path beginning with
 * `-` is treated as a path rather than parsed as flags. */
const rmCommand = (path: string): string => `rm -rf -- ${shellQuote(path)}`;

/** Non-recursive, for a directory that is only ever legitimately empty (a steal claim). If
 * something else has taken that path, `rmdir` refusing is the right outcome — a recursive remove
 * would erase it without anyone finding out. */
const rmdirCommand = (path: string): string => `rmdir -- ${shellQuote(path)}`;

export { editCommand, rmCommand, rmdirCommand, shellQuote };
