// How long refs lets one subprocess run before ending it, read from `REFS_GIT_TIMEOUT`.
//
// A stalled server, or a credential prompt `GIT_TERMINAL_PROMPT=0` does not reach (an ssh
// passphrase, a GUI helper), otherwise blocks `refs add` or `refs sync` for as long as nobody
// notices, holding the per-ref lock. The bound is per command and applies to every one refs runs,
// not only to clone and fetch: `git remote set-head --auto` contacts the remote too, and in a
// blobless checkout `checkout`, `reset` and `show` fetch missing blobs on demand, so "which git
// commands touch the network" has no answer refs could keep current. A local command that runs
// for this long is no healthier than a network one.
//
// The default is generous on purpose. A hard limit that a legitimate first clone of a large
// repository over a slow link can reach turns a slow success into a failure; this one exists to
// end hangs, not to police throughput. `0` turns it off; a value that is not a whole number of
// seconds is ignored, like `REFS_UPDATE_CHECK`'s, so a typo cannot turn the bound off.

const GIT_TIMEOUT_VARIABLE = 'REFS_GIT_TIMEOUT';
const DEFAULT_GIT_TIMEOUT_SECONDS = 900;
const MS_PER_SECOND = 1000;
// `setTimeout` stores its delay in a signed 32-bit integer and fires after 1ms when given more,
// which would turn a very large setting into an immediate timeout.
const MAX_TIMER_MS = 2_147_483_647;
const WHOLE_SECONDS = /^\d+$/u;

/** The `timeoutMs` a command gets when its caller passes none; `undefined` means no bound. */
const commandTimeoutMs = (env: NodeJS.ProcessEnv): number | undefined => {
  const raw = env[GIT_TIMEOUT_VARIABLE]?.trim() ?? '';
  const seconds = WHOLE_SECONDS.test(raw) ? Number(raw) : DEFAULT_GIT_TIMEOUT_SECONDS;
  if (seconds === 0) {
    return undefined;
  }
  return Math.min(seconds * MS_PER_SECOND, MAX_TIMER_MS);
};

export { DEFAULT_GIT_TIMEOUT_SECONDS, GIT_TIMEOUT_VARIABLE, commandTimeoutMs };
