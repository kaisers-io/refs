import { usageError } from '@kaisers-io/refs-core';

// `REFS_NETWORK_TIMEOUT`: an optional deadline, in seconds, for each git command that talks to the
// remote — clone, fetch, and `remote set-head --auto`. Off unless set: a fixed default would
// abort a legitimate large clone on a slow link, and how long is too long is the user's call.
//
// What it bounds: at the deadline refs stops git and the helpers it started — the remote helper,
// `index-pack`, ssh — as one process group or tree (core's spawn-timeout.ts; SIGTERM, then
// SIGKILL), and waits for their output pipes to close before removing a half-finished clone. The
// bound is the deadline plus that short wind-down, not a hard wall-clock limit.
//
// An unusable value is refused rather than ignored: a typo silently meaning "no deadline" is
// exactly the hang the variable exists to prevent.

const VARIABLE = 'REFS_NETWORK_TIMEOUT';
const MS_PER_SECOND = 1000;
// `setTimeout` keeps its delay in a signed 32-bit integer of milliseconds; anything longer fires
// at once.
const MAX_TIMER_MS = 2_147_483_647;
const MAX_SECONDS = Math.floor(MAX_TIMER_MS / MS_PER_SECOND);
const WHOLE_SECONDS = /^\d+$/u;

/** The configured network deadline in milliseconds, or `undefined` for none. */
const networkTimeoutFrom = (env: NodeJS.ProcessEnv): number | undefined => {
  const raw = env[VARIABLE]?.trim() ?? '';
  if (raw === '') {
    return undefined;
  }
  const seconds = WHOLE_SECONDS.test(raw) ? Number(raw) : Number.NaN;
  if (!(seconds <= MAX_SECONDS)) {
    throw usageError(
      `${VARIABLE} must be a whole number of seconds up to ${String(MAX_SECONDS)}, or 0 for no ` +
        `deadline — got '${raw}'`,
    );
  }
  return seconds === 0 ? undefined : seconds * MS_PER_SECOND;
};

/** `{ networkTimeoutMs }` when a deadline is configured, `{}` otherwise — spread into git opts. */
const networkTimeoutOpt = (env: NodeJS.ProcessEnv): { networkTimeoutMs?: number } => {
  const ms = networkTimeoutFrom(env);
  return ms === undefined ? {} : { networkTimeoutMs: ms };
};

export { networkTimeoutFrom, networkTimeoutOpt };
