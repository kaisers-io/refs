import type { Runner } from '../proc/runner.ts';

// A `Runner` whose git calls carry refs' hooks directory at COMMAND scope: `git -c
// core.hooksPath=<hooksDir> <command>`.
//
// The marker `cloneRepo` writes is repository-local configuration, and command-scope
// configuration outranks it. refs passes `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT` through to
// its children on purpose (`proc/child-env.ts`: CI injects credentials and `insteadOf` rewrites
// that way), and git exports `GIT_CONFIG_PARAMETERS` to every hook started under `git -c`. An
// inherited relative `core.hooksPath=.githooks` therefore pointed the clone's checkout, and every
// later `checkout -B`, `fetch` and `reset` in a sync, at hooks the cloned repository tracks itself.
// Measured on git 2.43 for both variables: the upstream's `.githooks/post-checkout` ran during the
// clone and during `checkout -B`; with the top-level `-c` it ran in neither. A top-level `-c` is
// appended after the inherited entries, so it is the value git applies, and it is not persisted.
//
// The CLI applies this ONCE, to the runner every command receives (`pinned-runner.ts` in the CLI
// package), not per call site: a call site that had to remember the wrap was a call site that could
// forget it. Pinning every git call is safe. A command-scope `core.hooksPath` does not reach the
// marker guard, which reads `config --local`, nor the marker the clone writes, which lands in the
// new repository's local config. refs never commits, and a hooks directory that does not exist yet
// only means that no hook runs.
const pinHooksPath = (runner: Runner, hooksDir: string): Runner => ({
  run: (cmd, args, opts) =>
    runner.run(cmd, cmd === 'git' ? ['-c', `core.hooksPath=${hooksDir}`, ...args] : args, opts),
});

export { pinHooksPath };
