// Shared redaction helper for any message that might interpolate a raw, possibly-credentialed git
// url — a url can carry embedded credentials (`https://user:pass@host/...`, or a bare
// `git@host:path` scp form), which must never reach stderr/logs verbatim. Kept in its own module
// (rather than inline in `git-url.ts`) so BOTH `git-url.ts`'s own guard messages and the CLI's
// checkout-identity guard (`add-checkout-guards.ts`'s origin-mismatch message, which renders a real
// `git remote get-url origin` value that may itself carry a credentialed origin) share ONE
// implementation instead of duplicating the regex.

// Redacts everything from the start of the string up to (and including) the LAST `@`, preserving
// only a well-formed leading `scheme://` when one exists. Deliberately maximal: precise,
// start-anchored userinfo patterns leak on inputs that aren't a single well-formed url — a second
// credentialed url later in the string, a bare `user:pass@` not at index 0, whitespace inside the
// would-be userinfo. Redaction here may be lossy on garbage input (the accepted trade-off); a
// candidate secret must never survive just because it contains a space, slash, or an extra url
// before it.
const THROUGH_LAST_AT_PATTERN = /^(?<scheme>[a-z][a-z0-9+.-]*:\/\/)?[\s\S]*@/iu;
const REDACTED_THROUGH_LAST_AT = '$<scheme><redacted>@';

const MAX_REDACTED_LENGTH = 200;
const TRUNCATION_SUFFIX = '…';

/** Strips any potential userinfo from `raw` (`scheme://user:pass@host/...` →
 * `scheme://<redacted>@host/...`; `git@host:path` → `<redacted>@host:path`; on multi-url or
 * garbage input everything up to the LAST `@` is redacted — lossy by design, see the pattern
 * comment above) and truncates the result to a sane length — for use whenever an
 * otherwise-untrusted, possibly-credentialed string must still appear (in redacted form) inside an
 * error/log message. Strings without any `@` pass through unchanged (aside from truncation). */
// The conventional forge username for ssh access. It is a fixed, public convention rather than a
// secret, so redacting it would mark every ordinary ssh ref as credential-bearing while telling the
// reader nothing. The exemption is deliberately narrow: exact equality, and only for the ssh
// transports where the convention actually applies.
const CONVENTIONAL_SSH_USER = 'git';
// The scp form refs accepts, which the URL parser cannot read at all. Same shape as the
// canonicalizer's, so anything it matches is a url refs would have stored.
const CONVENTIONAL_SCP = /^git@[^:/\s]+:[^\s]+$/u;

/** For a url being DISPLAYED rather than reported in an error.
 *
 * Decided on the PARSED url rather than by pattern-matching the string: userinfo runs to the last
 * `@` before the authority ends, a password may itself contain an `@`, and a leading space or a
 * space inside the userinfo still parses — a regex that gets any of those wrong fails OPEN, which
 * for a credential is the wrong direction. Anything that neither parses as a url nor matches the
 * scp form falls back to the maximal `redactUrl`, because "could not identify the userinfo" must
 * not mean "safe to print".
 *
 * This redacts USERINFO. It is not a promise that the result carries no secret: a token in a query
 * string, or one someone put in a description, is a different problem. */
const parsedOrUndefined = (raw: string): URL | undefined => {
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
};

/** The conventional `git@host` over a transport where that convention actually applies. */
const isConventionalSshUser = (url: URL): boolean =>
  url.password === '' && url.username === CONVENTIONAL_SSH_USER && url.protocol === 'ssh:';

const redactUrlForDisplay = (raw: string): string => {
  if (CONVENTIONAL_SCP.test(raw)) {
    return raw;
  }
  const url = parsedOrUndefined(raw);
  if (url === undefined) {
    return raw.includes('@') ? redactUrl(raw) : raw;
  }
  if ((url.username === '' && url.password === '') || isConventionalSshUser(url)) {
    return raw;
  }
  return `${url.protocol}//<redacted>@${url.host}${url.pathname}${url.search}${url.hash}`;
};

const redactUrl = (raw: string): string => {
  const withoutCredentials = raw.replace(THROUGH_LAST_AT_PATTERN, REDACTED_THROUGH_LAST_AT);
  if (withoutCredentials.length <= MAX_REDACTED_LENGTH) {
    return withoutCredentials;
  }
  return `${withoutCredentials.slice(0, MAX_REDACTED_LENGTH)}${TRUNCATION_SUFFIX}`;
};

export { redactUrl, redactUrlForDisplay };
