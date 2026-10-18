// Command-scope configuration refs puts in front of every git command it runs.
//
// refs clones repositories so they can be read; it is not there to run their code. So a git
// command refs starts runs git and nothing else: no hook, no fsmonitor command, no submodule
// command. Content filters are switched off per checkout (git/filter-guard.ts); git 2.54.x is
// refused outright (git-version-gate.ts). What stays is what the TRANSPORT needs from the user's
// own setup: credential helpers, `core.sshCommand`/`GIT_SSH_COMMAND`, askpass and proxies, without
// which a private clone or fetch cannot authenticate. Those are the user's programs, chosen in the
// user's configuration; a tracked repository cannot name one.
//
// The mechanisms, and why each spelling. Tested on git 2.30, 2.39, 2.47, 2.53 and 2.55 (CI runs
// 2.55 and 2.56); the fsmonitor spelling was also measured on 2.25 and 2.34:
//
// - `core.hooksPath=<refs' hooks directory>` (when the runner knows it). The checkout's own
//   `.git/config` already says so, but command-scope configuration inherited through
//   `GIT_CONFIG_PARAMETERS`/`GIT_CONFIG_COUNT` outranks that file, and a relative value there
//   (`.githooks`) resolves inside the checkout. The directory only holds refs' commit and push
//   guards, which none of refs' own commands fire.
// - `core.fsmonitor=` (empty), not `=false`. Git 2.35.1 and older read `false` as a hook PATHNAME
//   and run a program called `false`; the empty value disables the hook form on every version.
// - `hook.<event>.enabled=false` for EVERY event git documents (githooks(5), 2.56), not just the
//   ones refs is known to fire today: configured hooks (`[hook "<label>"]`, 2.54+) are not found
//   through the hooks directory. Git 2.55 introduced the switch; older git has no configured hooks
//   (2.53 and before) or ignores it (2.54, hence the refusal). The switch is not enough on its own:
//   git reads `hook.<name>.enabled` as a LABEL switch once a label of that name exists, and the
//   event's other labels then run. So on 2.55+ refs also switches each configured label off by
//   name (git-hook-labels.ts).
// - `submodule.recurse=false` and `fetch.recurseSubmodules=false`, so a user default cannot make
//   `checkout`/`reset`/`fetch` reach into submodules a tracked `.gitmodules` names.
// - As TOP-LEVEL options. Command scope outranks every configuration file, and a top-level `-c`
//   also outranks command-scope configuration inherited through the environment. For a clone it
//   applies to the initial checkout and is not written into the new repository's config, so an
//   agent's own git commands in a checkout keep the user's setup.
//
// Not added, because no command refs runs triggers them (each verified by a test in
// test/git/git-not-triggered-real.test.ts): `core.pager` (git pages only to a terminal, and refs
// reads git's output through a pipe), `diff.external` and textconv drivers (refs' only `diff` is
// `--name-only`, and `git show <rev>:<path>` prints a blob without textconv unless asked to).
//
// The cost: refs' own `status`, `checkout` and `reset` lose fsmonitor acceleration and refresh the
// index in full.

const HOOK_EVENTS = [
  'applypatch-msg',
  'commit-msg',
  'fsmonitor-watchman',
  'p4-changelist',
  'p4-post-changelist',
  'p4-pre-submit',
  'p4-prepare-changelist',
  'post-applypatch',
  'post-checkout',
  'post-commit',
  'post-index-change',
  'post-merge',
  'post-receive',
  'post-rewrite',
  'post-update',
  'pre-applypatch',
  'pre-auto-gc',
  'pre-commit',
  'pre-merge-commit',
  'pre-push',
  'pre-rebase',
  'pre-receive',
  'prepare-commit-msg',
  'proc-receive',
  'push-to-checkout',
  'reference-transaction',
  'sendemail-validate',
  'update',
] as const;

const GIT_POLICY_ARGS: readonly string[] = [
  '-c',
  'core.fsmonitor=',
  '-c',
  'submodule.recurse=false',
  '-c',
  'fetch.recurseSubmodules=false',
  ...HOOK_EVENTS.flatMap((event) => ['-c', `hook.${event}.enabled=false`]),
];

/** `args` with refs' git policy in front when `cmd` is git; any other command's args unchanged.
 * `hooksDir`, when known, pins `core.hooksPath` at command scope as well. */
// `hooksDir`: refs' hooks directory, pinned as `core.hooksPath`. `labelArgs`: the per-label hook
// switches for git 2.55+ (git-hook-labels.ts), after the event switches.
type GitPolicyOpts = { hooksDir?: string | undefined; labelArgs?: readonly string[] | undefined };

const withGitPolicy = (
  cmd: string,
  args: readonly string[],
  opts: GitPolicyOpts = {},
): readonly string[] => {
  if (cmd !== 'git') {
    return args;
  }
  const hooksPath = opts.hooksDir === undefined ? [] : ['-c', `core.hooksPath=${opts.hooksDir}`];
  return [...hooksPath, ...GIT_POLICY_ARGS, ...(opts.labelArgs ?? []), ...args];
};

export { GIT_POLICY_ARGS, HOOK_EVENTS, withGitPolicy };
export type { GitPolicyOpts };
