import { redactUrlsInText } from '../git-url-redact.ts';

// A git failure message carries the child's own output, which is remote-controlled text: the
// stream cap in `spawn-collector.ts` is 64 MiB, a safety valve against an OOM rather than a bound
// suitable for a message that ends up in the `--json` envelope an agent parses. Bound it at the
// one seam every failing git command passes through, and strip url userinfo on the way — git 2.54
// already does the latter for its own `unable to access` line, so that half is defence in depth
// for a git that does not.
//
// Its own module because `repo.ts` reached the 300-line cap; nothing else about it changed.

const MAX_DETAIL_LENGTH = 2000;
const DETAIL_TRUNCATION_SUFFIX = '… (truncated)';

/** A child's output, redacted and bounded, ready to go into a failure message. */
const failureDetail = (raw: string): string => {
  const redacted = redactUrlsInText(raw);
  return redacted.length <= MAX_DETAIL_LENGTH
    ? redacted
    : `${redacted.slice(0, MAX_DETAIL_LENGTH)}${DETAIL_TRUNCATION_SUFFIX}`;
};

// Two failures whose raw git text does not say what to do about them.
//
// A timed-out command was killed by refs (`REFS_NETWORK_TIMEOUT`), so its output is whatever git
// had written so far. And with `GIT_TERMINAL_PROMPT=0`, which refs sets unless the user set it
// (proc/child-env.ts), a remote that wants https credentials fails with git's terse "terminal
// prompts disabled".
const PROMPTS_DISABLED = /terminal prompts disabled/iu;
const MS_PER_SECOND = 1000;

const CREDENTIALS_HINT =
  'git needed credentials and refs does not let it prompt for them — configure a credential ' +
  'helper (git help credential) or use an ssh url, or set GIT_TERMINAL_PROMPT=1 to be asked';

type FailedRun = { exitCode: number; stderr: string; stdout: string; timedOut?: boolean };

/** The message a failed git step throws with: what failed, the child's bounded output, and a hint
 * when the failure is one refs itself shaped. */
const failureMessage = (action: string, result: FailedRun, timeoutMs?: number): string => {
  if (result.timedOut === true) {
    const seconds = String((timeoutMs ?? 0) / MS_PER_SECOND);
    return `${action} timed out after ${seconds}s (REFS_NETWORK_TIMEOUT) and was stopped`;
  }
  const raw = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
  const detail = `${action} failed: ${failureDetail(raw)}`;
  return PROMPTS_DISABLED.test(raw) ? `${detail} — ${CREDENTIALS_HINT}` : detail;
};

export { DETAIL_TRUNCATION_SUFFIX, MAX_DETAIL_LENGTH, failureDetail, failureMessage };
