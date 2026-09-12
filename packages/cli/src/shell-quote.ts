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
