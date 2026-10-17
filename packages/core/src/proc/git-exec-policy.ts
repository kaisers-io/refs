// The execution policy every git process refs starts runs under, applied in `SpawnRunner` — the
// one module allowed to start a process (`spawn-surface.test.ts`), so no call site can miss it.
//
// `core.hooksPath` keeps hook FILES inside a checkout from running, but git can be made to run a
// command by two other mechanisms that do not route through it, both defined in the invoking
// user's own configuration (#194):
//
// - `core.fsmonitor` in its command form. git runs it with the worktree as its working directory,
//   so a repository that tracks a file at that path supplies the program.
// - Configured hooks, `[hook "<label>"] event = …, command = …` (git 2.54 and later). Measured on
//   2.54.0 and 2.55.0 with `core.hooksPath` pinned at a refs-owned directory: a configured hook
//   whose command is `./evil.sh` ran the CHECKOUT's own copy of that script during the clone, the
//   fetch, `checkout -B` and `reset --hard`.
//
// Neither has a content-materialisation purpose, so turning both off for refs' own invocations
// changes nothing a checkout's reader depends on. Content filters (`filter.<name>.*`) are NOT
// touched: emptying one changes what a checkout contains, and with `filter.<name>.required` — which
// git-lfs sets — fails the checkout outright (#187).
//
// The cost is fsmonitor's acceleration for refs' own `status`, `checkout` and `reset`: each does a
// full index refresh instead. That is one scan per sync, small next to the fetch, but measurable on
// a very large tree. Agents' own git commands inside a checkout are not refs' invocations and keep
// the user's settings.
//
// Every option is TOP-LEVEL (`git -c … <command>`), never `clone -c`: a top-level `-c` governs the
// whole invocation — including the checkout a clone performs and every git child process, which
// inherit it through `GIT_CONFIG_PARAMETERS` — and is not persisted into the new repository's
// config. Measured: `git config --local --get core.fsmonitor` exits 1 after such a clone.

// The EMPTY value, not `false`. `false` is only a boolean to git 2.36 and later; git 2.35.1 and
// older read it as a hook pathname and try to invoke a program named `false` (git-config(1),
// `core.fsmonitor`). The empty value turns the command form off on every version measured (2.43.0,
// 2.54.0, 2.55.0 here; 2.25.1 through 2.39.5 in #194).
const FSMONITOR_OFF = 'core.fsmonitor=';

// Every hook event refs' own invocations fire. Measured on 2.55.0 by configuring a hook for each of
// git's events and running refs' sequence: `reference-transaction` (clone, fetch,
// `remote set-head`, reset, `checkout -B`), `post-index-change` (clone, `status`, reset,
// `checkout -B`) and `post-checkout` (clone, `checkout -B`); `pre-auto-gc` fires when an
// operation runs `gc --auto`, as a fetch may. refs never commits, merges, rebases or pushes.
//
// `hook.<event>.enabled=false` is an EVENT-level switch from git 2.55: it disables every configured
// hook for that event, whatever its label, so no label has to be discovered — which matters
// because a label can come from an `includeIf` section that applies only inside the checkout. It
// leaves hooks-DIRECTORY hooks alone, so the refs commit/push guard is unaffected (measured on
// 2.55.0). git 2.54 only understands `hook.<label>.enabled`, so there these settings are inert
// (measured) and `SpawnRunner` adds one `hook.<label>.enabled=false` per label instead, from an
// inventory of the whole configuration graph (`git-hook-labels.ts`); like these, those leave the
// hooks directory alone (measured on 2.54.0: the guard still blocks a commit). Before 2.54
// configured hooks do not exist and git ignores the unknown keys.
const NEUTRALISED_HOOK_EVENTS = [
  'post-checkout',
  'post-index-change',
  'pre-auto-gc',
  'reference-transaction',
] as const;

const GIT_EXEC_POLICY_ARGS: readonly string[] = [
  '-c',
  FSMONITOR_OFF,
  ...NEUTRALISED_HOOK_EVENTS.flatMap((event) => ['-c', `hook.${event}.enabled=false`]),
];

/** `args` with the policy prepended when `cmd` is git, untouched otherwise. Only the literal
 * `git` is matched: it is the one spelling refs uses, and matching a basename would apply git's
 * option syntax to a program that merely shares the name. */
const withGitExecPolicy = (cmd: string, args: readonly string[]): readonly string[] =>
  cmd === 'git' ? [...GIT_EXEC_POLICY_ARGS, ...args] : args;

export { GIT_EXEC_POLICY_ARGS, withGitExecPolicy };
