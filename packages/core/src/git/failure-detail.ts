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

export { DETAIL_TRUNCATION_SUFFIX, MAX_DETAIL_LENGTH, failureDetail };
