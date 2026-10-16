// Command-scope configuration refs puts in front of every git command it runs.
//
// `core.hooksPath` keeps a checkout's own hook FILES from running, but two other git mechanisms run
// a command without consulting it, and either can be pointed at a script the checkout supplies:
//
// - `core.fsmonitor` in its command form. git runs it with the worktree as its working directory,
//   so `./fsm.sh` names the checkout's copy.
// - Configured hooks (`[hook "<label>"] event = …; command = …`, git 2.54+). They are not
//   discovered through the hooks directory, so the pinned `core.hooksPath` does not route them.
//
// Both need a definition already in the invoking user's configuration; a tracked repository
// cannot create one. Neither has anything to do with what a checkout contains, so switching them
// off for refs' own commands costs a reader nothing. Content filters are deliberately NOT touched:
// emptying one changes the checked-out bytes, and a `required` filter (git-lfs sets one) fails the
// checkout outright.
//
// Why these spellings, measured on git 2.25, 2.30, 2.34, 2.39, 2.47, 2.53 and 2.55:
//
// - `core.fsmonitor=` (empty), not `=false`. Git 2.35.1 and older read `false` as a hook PATHNAME
//   and try to run a program called `false`; the empty value disables the hook form on every
//   version tested.
// - `hook.<event>.enabled=false` switches every configured hook for that event off from 2.55 on
//   (hook.c), with no label discovery, so `includeIf` sections that only apply inside a checkout
//   cannot hide one. It leaves hooks-directory hooks alone, so refs' own guard keeps working.
//   Before 2.54 there are no configured hooks and git ignores the keys. On 2.54.x the switch only
//   exists per label; `refs doctor` warns there rather than refs guessing at labels.
// - As TOP-LEVEL options. Command scope outranks every configuration file, and a top-level `-c`
//   also outranks command-scope configuration inherited through `GIT_CONFIG_PARAMETERS` and
//   `GIT_CONFIG_COUNT`. For a clone it applies to the initial checkout and is not written into the
//   new repository's config, so an agent's own git commands in a checkout keep the user's setup.
//
// The events are the ones refs' commands can fire: `post-checkout` (clone, `checkout -B`),
// `reference-transaction` (fetch, reset, `remote set-head`), `post-index-change` (reset, checkout,
// the index refresh `status` does) and `pre-auto-gc` (fetch can start `gc --auto`).
//
// The cost: refs' own `status`, `checkout` and `reset` lose fsmonitor acceleration and refresh the
// index in full.

const HOOK_EVENTS = [
  'post-checkout',
  'post-index-change',
  'pre-auto-gc',
  'reference-transaction',
] as const;

const GIT_POLICY_ARGS: readonly string[] = [
  '-c',
  'core.fsmonitor=',
  ...HOOK_EVENTS.flatMap((event) => ['-c', `hook.${event}.enabled=false`]),
];

/** `args` with refs' git policy in front when `cmd` is git; any other command's args unchanged. */
const withGitPolicy = (cmd: string, args: readonly string[]): readonly string[] =>
  cmd === 'git' ? [...GIT_POLICY_ARGS, ...args] : args;

export { GIT_POLICY_ARGS, HOOK_EVENTS, withGitPolicy };
