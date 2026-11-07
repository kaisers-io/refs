// Which git subcommand an argv runs, past the global options in front of it. A caller may prepend
// `-c k=v` pairs — a runner wrapper that pins `core.hooksPath` does — so `args[0]` is not the
// subcommand in general, and a check keyed on it silently stops applying.

import { resolve } from 'node:path';

// git's global options that take their value as the NEXT argument (`handle_options` in git.c).
// Every other leading `-…` argument stands alone.
const VALUED_GLOBAL_OPTIONS = new Set([
  '--attr-source',
  '--config-env',
  '--git-dir',
  '--namespace',
  '--work-tree',
  '-C',
  '-c',
]);
const OPTION_AND_VALUE = 2;

/** The subcommand and its arguments (`rest`), and the directory git runs it in when the caller
 * chose one: `cwd`, then each `-C` in turn, as git applies them. */
const commandOf = (args: readonly string[], cwd?: string): { dir?: string; rest: string[] } => {
  let at = 0;
  let dir = cwd === undefined ? undefined : resolve(cwd);
  while (args[at]?.startsWith('-') === true) {
    if (args[at] === '-C') {
      dir = resolve(dir ?? '.', args[at + 1] ?? '');
    }
    at += VALUED_GLOBAL_OPTIONS.has(args[at] ?? '') ? OPTION_AND_VALUE : 1;
  }
  return { ...(dir === undefined ? {} : { dir }), rest: args.slice(at) };
};

export { commandOf };
