// Shared redaction helper for any message that might interpolate a raw, possibly-credentialed git
// url — a url can carry embedded credentials (`https://user:pass@host/...`, or a bare
// `git@host:path` scp form), which must never reach stderr/logs verbatim. Kept in its own module
// (rather than inline in `git-url.ts`) so BOTH `git-url.ts`'s own guard messages and the CLI's
// checkout-identity guard (`add-checkout-guards.ts`'s origin-mismatch message, which renders a real
// `git remote get-url origin` value that may itself carry a credentialed origin) share ONE
// implementation instead of duplicating the regex.

// Matches a userinfo segment right after a `//` (any scheme, even a malformed one the WHATWG
// parser itself rejected — the whole point is this can fire on strings that never got that far).
const SCHEME_USERINFO_PATTERN = /\/\/[^\s/@]*@/u;
const REDACTED_SCHEME_USERINFO = '//<redacted>@';

// Matches a bare `user@`/`user:pass@` prefix with no scheme at all — the scp form (`git@host:path`).
// Anchored to the START only: once the scheme-form replacement above has already fired, nothing
// starting at index 0 can still end in an unescaped `@` before its first `/`, so this never
// double-fires on the same userinfo segment.
const BARE_USERINFO_PATTERN = /^[^\s/@]+@/u;
const REDACTED_BARE_USERINFO = '<redacted>@';

const MAX_REDACTED_LENGTH = 200;
const TRUNCATION_START = 0;
const TRUNCATION_SUFFIX = '…';

/** Strips any userinfo from `raw` (`scheme://user:pass@host/...` → `scheme://<redacted>@host/...`;
 * `git@host:path` → `<redacted>@host:path`) and truncates the result to a sane length — for use
 * whenever an otherwise-untrusted, possibly-credentialed string must still appear (in redacted
 * form) inside an error/log message. Urls without any userinfo pass through unchanged (aside from
 * truncation). */
const redactUrl = (raw: string): string => {
  const withoutSchemeUserinfo = raw.replace(SCHEME_USERINFO_PATTERN, REDACTED_SCHEME_USERINFO);
  const withoutCredentials = withoutSchemeUserinfo.replace(
    BARE_USERINFO_PATTERN,
    REDACTED_BARE_USERINFO,
  );
  if (withoutCredentials.length <= MAX_REDACTED_LENGTH) {
    return withoutCredentials;
  }
  return `${withoutCredentials.slice(TRUNCATION_START, MAX_REDACTED_LENGTH)}${TRUNCATION_SUFFIX}`;
};

export { redactUrl };
