import type { Config, RefsHome } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level value import
import {
  isBehind,
  loadLatestVersion,
  resolveHome,
  shouldCheck,
  updateMessage,
} from '@kaisers-io/refs-core';
import type { CheckResult } from './doctor-types.ts';
import type { CliContext } from '../context.ts';

// The `cli-update` check: is a newer refs published on npm? This is one of the two places that may
// contact the registry (the other is `refs sync`), and the only one that reports it as a check.
//
// `[updates].notify` is deliberately NOT consulted here. It governs whether routine commands
// interrupt with the news; running `refs doctor` is asking for a health report, and withholding a
// known answer from someone who asked would be the wrong kind of quiet. `[updates].check` and
// `REFS_UPDATE_CHECK` do apply — those say "don't go to the network", which is a different thing.
//
// Everything is caught in here. An escaping throw becomes a `fail` in `doctor.ts`'s `runStepSafely`,
// and a `fail` makes `refs doctor` exit non-zero — so an unreachable registry or an unwritable cache
// would turn a healthy machine into a failing one.

const checkCliUpdate = async (ctx: CliContext, config: Config): Promise<CheckResult> => {
  const disabled: CheckResult = {
    detail: 'update check is disabled — remove [updates].check=false or set REFS_UPDATE_CHECK=1',
    name: 'cli-update',
    status: 'ok',
  };
  if (!shouldCheck({ env: ctx.env, updates: config.updates })) {
    return disabled;
  }

  const home: RefsHome = resolveHome(ctx.env);
  const { latest } = await loadLatestVersion({ fetch: ctx.fetcher, home, nowMs: Date.now() });
  if (latest === undefined) {
    return {
      detail:
        'could not reach npm to learn the latest published version — this is not a fault of your setup, and nothing else depends on it',
      name: 'cli-update',
      status: 'warn',
    };
  }
  if (isBehind(ctx.cliVersion, latest)) {
    return {
      detail: updateMessage(ctx.cliVersion, latest),
      name: 'cli-update',
      status: 'warn',
    };
  }
  return {
    detail: `this CLI (${ctx.cliVersion}) is npm's latest published release`,
    name: 'cli-update',
    status: 'ok',
  };
};

export { checkCliUpdate };
