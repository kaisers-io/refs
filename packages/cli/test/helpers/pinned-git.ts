import type { FakeRunner, RefsHome } from '@kaisers-io/refs-core';

// Every git call a command makes through the CLI carries refs' hooks directory at command scope
// (`src/pinned-runner.ts`). These helpers script that form rather than strip it, so a FakeRunner
// test still fails when a call arrives WITHOUT the pin.

const pinnedGit = (home: RefsHome): string => `git -c core.hooksPath=${home.hooksDir}`;

/** Rewrites each scripted `git …` prefix queued on `runner` into its pinned form, for suites that
 * script many calls against one home. Commands other than git are queued unchanged. */
const scriptGitThroughPin = (runner: FakeRunner, home: RefsHome): void => {
  const queue = runner.expect.bind(runner);
  const pinned = pinnedGit(home);
  runner.expect = (cmdPrefix, result, opts) => {
    queue(
      cmdPrefix.startsWith('git ') ? `${pinned}${cmdPrefix.slice('git'.length)}` : cmdPrefix,
      result,
      opts,
    );
  };
};

export { pinnedGit, scriptGitThroughPin };
