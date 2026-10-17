import type { ChildProcess } from 'node:child_process';
import { terminateProcessTree } from './process-tree.ts';

type TimeoutHandle = {
  markedTimedOut: () => boolean;
  finish: () => Promise<string | undefined>;
  failure: Promise<string>;
};

// A direct child can close its own streams while a helper still writes into the clone. Once a
// deadline fires, finish MUST await tree termination even if the child's close event wins.
const armTimeout = (child: ChildProcess, timeoutMs: number | undefined): TimeoutHandle => {
  let timedOut = false;
  // eslint-disable-next-line unicorn/no-useless-undefined -- explicit generic value keeps this Promise distinct from Promise<void>
  let termination: Promise<string | undefined> = Promise.resolve<string | undefined>(undefined);
  const failure = Promise.withResolvers<string>();
  const terminate = async (): Promise<string | undefined> => {
    const error = await terminateProcessTree(child);
    if (error !== undefined) {
      failure.resolve(error);
    }
    return error;
  };
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          termination = terminate();
        }, timeoutMs);
  return {
    failure: failure.promise,
    finish: () => {
      clearTimeout(timer);
      return termination;
    },
    markedTimedOut: () => timedOut,
  };
};

export { armTimeout };
