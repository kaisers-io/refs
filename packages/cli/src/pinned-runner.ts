import { pinHooksPath, resolveHome } from '@kaisers-io/refs-core';
import type { CliContext } from './context.ts';
import type { Runner } from '@kaisers-io/refs-core';

// The one place refs' hooks pin (`pinHooksPath`, core `git/pinned-hooks.ts`) is applied: every
// command receives a context whose runner prefixes each `git` call with
// `-c core.hooksPath=<REFS_HOME>/hooks`. Applied here rather than at each call site, so a new git
// call cannot be added without it.
//
// The home is resolved at the FIRST git call, then reused. The context is built before arguments
// are parsed, and `resolveHome` can throw on a host with no home directory, so resolving it up
// front would fail `refs --help` too. Every command resolves the same home from the same `env`
// before it spawns git, so the lazy answer is the one the command itself uses.
//
// `ctx.runner` is read at call time rather than captured, so a caller that swaps the runner on
// the context it passed in is still the runner the pin wraps.
const withHooksPin = (ctx: CliContext): CliContext => {
  const memo: { pinned?: Runner } = {};
  const runner: Runner = {
    run: (cmd, args, opts) => {
      memo.pinned ??= pinHooksPath(
        { run: (...call) => ctx.runner.run(...call) },
        resolveHome(ctx.env).hooksDir,
      );
      return memo.pinned.run(cmd, args, opts);
    },
  };
  return { ...ctx, runner };
};

export { withHooksPin };
