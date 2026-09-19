import { describe, expect, it } from 'vitest';
import { redactUrlsInText } from '../src/git-url-redact.ts';

// The quantifiers in `URL_USERINFO_IN_TEXT` are bounded, and that is load-bearing. The unbounded
// form `[a-z][a-z0-9+.-]*://` is a polynomial ReDoS: a long run of scheme-shaped characters makes
// the engine rescan the rest of the string from every start position. Measured on it against a run
// of `a` — 6 ms at 2 000 characters, 156 ms at 10 000, 2.5 s at 40 000 — and the input here is a
// child process's stderr, capped only by the runner's 64 MiB.
//
// The bounds cost nothing real: no url scheme is 32 characters, and no userinfo that belongs in a
// diagnostic is 256.

const LENGTH = 200_000;
const LONG_SCHEME_SHAPED_INPUT = 'a'.repeat(LENGTH);
// Generous by two orders of magnitude against the measured 24 ms, so this fails on the quadratic
// shape and not on a slow machine.
const REDACTION_BUDGET_MS = 1000;
const LONG_USERINFO_LENGTH = 200;

describe('text that looks like it might be a scheme, at length', () => {
  it('is scanned in time proportional to its length', () => {
    expect.hasAssertions();
    const started = performance.now();

    const result = redactUrlsInText(LONG_SCHEME_SHAPED_INPUT);

    expect(result).toBe(LONG_SCHEME_SHAPED_INPUT);
    expect(performance.now() - started).toBeLessThan(REDACTION_BUDGET_MS);
  });

  it('still redacts a url whose userinfo is long but plausible', () => {
    expect.hasAssertions();
    const token = 'x'.repeat(LONG_USERINFO_LENGTH);

    expect(redactUrlsInText(`fatal: https://u:${token}@example.com/o/r.git`)).toBe(
      'fatal: https://<redacted>@example.com/o/r.git',
    );
  });
});
