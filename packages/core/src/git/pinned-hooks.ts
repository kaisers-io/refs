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
// Only for commands that run inside, or create, a checkout refs manages. Not the guard that READS
// the marker: it uses `config --local`, which no `-c` reaches, and stays unwrapped to keep it that
// obvious.
const pinHooksPath = (runner: Runner, hooksDir: string): Runner => ({
  run: (cmd, args, opts) =>
    runner.run(cmd, cmd === 'git' ? ['-c', `core.hooksPath=${hooksDir}`, ...args] : args, opts),
});

export { pinHooksPath };
