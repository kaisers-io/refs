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
//
// Quoting alone is not the whole control, which is why the builders here return `undefined`
// instead of a string: a value that cannot survive being PRINTED must not be handed to a caller
// as a command at all, and making that an absent value rather than a convention is what stops the
// next command producer from forgetting it. Every dynamic part of a command goes through one of
// these builders — the raw value, not a pre-quoted fragment.

const CONTROL_CHARACTER = /\p{Cc}/u;

/** Whether this value can go into a printed command at all.
 *
 * Two ways it cannot. A control character survives single quotes, so the command spans two lines
 * and is no longer one pasteable line; and refs neutralises control characters on the way to a
 * terminal, so what the reader sees names a DIFFERENT package or path. Encoding it as ANSI-C
 * `$'…'` looked like the answer and is not: `sh` on Debian and Ubuntu is dash, which has no such
 * syntax, and measured there the command does not fail — it SUCCEEDS, against a package literally
 * named `$x\x0Ay`. A lone surrogate is the same failure one layer down: it is not a control
 * character, but it has no UTF-8 encoding, so the bytes written are already not the value.
 *
 * A command that silently acts on the wrong thing is worse than no command, so no command is
 * offered. The finding itself is still reported, and `--json` still carries the exact value. */
const isPasteable = (value: string): boolean =>
  !CONTROL_CHARACTER.test(value) && value.isWellFormed();

/** Single-quotes `value` for a shell, closing and reopening the quote around any embedded `'`. */
const shellQuote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;

/** An option in a printed command: a bare flag, or a flag with a value that needs quoting. */
type CommandOption = string | readonly [flag: string, value: string];

const optionValue = (option: CommandOption): string | undefined =>
  typeof option === 'string' ? undefined : option[1];

const renderOption = (option: CommandOption): string =>
  typeof option === 'string' ? option : `${option[0]}=${shellQuote(option[1])}`;

/** `refs edit` as a line that survives BOTH parsers it has to pass, or `undefined` when one of its
 * values cannot be printed at all.
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
 * misread is not. */
const editCommand = (
  opts: readonly CommandOption[],
  positionals: readonly string[],
): string | undefined => {
  const values = [
    ...opts.map((option) => optionValue(option)).filter((value) => value !== undefined),
    ...positionals,
  ];
  if (!values.every((value) => isPasteable(value))) {
    return undefined;
  }
  const terminator = positionals.some((value) => value.startsWith('-')) ? ['--'] : [];
  return [
    'refs edit',
    ...opts.map((option) => renderOption(option)),
    ...terminator,
    ...positionals.map((value) => shellQuote(value)),
  ].join(' ');
};

/** A `rm -rf` a human or agent can paste as-is, or `undefined` when any of its paths cannot be
 * printed. `--` ends the option list, so a path beginning with `-` is treated as a path rather than
 * parsed as flags. Takes several paths because a finding may name several, and one line that
 * removes all of them is a command; a line naming the first is a command that leaves the rest
 * behind — which is also why ONE unprintable path withholds the whole line rather than a part of
 * it. */
const rmCommand = (paths: string | readonly string[]): string | undefined => {
  const list = typeof paths === 'string' ? [paths] : paths;
  return list.every((path) => isPasteable(path))
    ? `rm -rf -- ${list.map((path) => shellQuote(path)).join(' ')}`
    : undefined;
};

/** Non-recursive, for a directory that is only ever legitimately empty (a steal claim). If
 * something else has taken that path, `rmdir` refusing is the right outcome — a recursive remove
 * would erase it without anyone finding out. */
const rmdirCommand = (path: string): string | undefined =>
  isPasteable(path) ? `rmdir -- ${shellQuote(path)}` : undefined;

export { editCommand, isPasteable, rmCommand, rmdirCommand, shellQuote };
export type { CommandOption };
