import { redactUrl } from './git-url-redact.ts';
import { validationError } from './errors.ts';

// Guards that must run against the RAW url string, before the WHATWG parser normalizes it — plus
// the percent guard, which needs the parsed url to know whether the `file:` exemption applies.
// Split out of `git-url.ts` to keep that file within its line budget; the reasoning for each guard
// lives with the guard.

// The WHATWG URL parser silently resolves `..`/`.` path segments before we ever see
// `url.pathname`, so traversal attempts must be caught on the raw input first.
const hasDotSegment = (raw: string): boolean =>
  raw.split('/').some((segment) => segment === '.' || segment === '..');
// Backslashes are treated as `/` by the WHATWG URL parser for special (e.g. https) schemes, so
// `a/b\..\c` can normalize into a traversal invisible to the raw, `/`-split check above. We reject
// any backslash outright: git clone urls never legitimately contain one.
const hasBackslash = (raw: string): boolean => raw.includes('\\');
// Percent-encoding lets a dot segment survive raw inspection (e.g. `%2e%2e`), which the WHATWG URL
// parser then resolves after our traversal check runs, producing a cloneUrl/key mismatch. Rather
// than decode-and-recheck every path segment, we reject any `%` in non-file forms outright: git
// hosts virtually never need percent-encoded paths, and zRefKey's SAFE_SEGMENT already forbids `%`
// in stored keys, so encoding here can only ever cause normalization surprises.
const hasPercentEncoding = (raw: string): boolean => raw.includes('%');
// Three more ways the parser can make `cloneUrl` and the derived key name different repositories,
// all of them the same shape as the backslash and percent guards above.
//
// 1. The parser STRIPS every ASCII tab, LF and CR anywhere in the input, before it resolves dot
//    segments — so `.<TAB>.` is three characters to the raw check and `..` to the parser.
// 2. It also strips leading and trailing C0-or-SPACE, so a TRAILING space makes `.. ` pass the raw
//    check and resolve as `..`. Interior spaces are fine and are left alone: a `file:` url for a
//    directory with a space in its name is legitimate and works today.
// 3. A query or fragment never reaches `url.pathname`, so `…/victim.git#attacker` derives the key
//    for `victim` while git asks the server for `victim.git#attacker` — confirmed with
//    `git fetch-pack --diag-url`.
//
// refs excludes all of these from the urls it supports. That is a policy about refs' input, not a
// claim that git cannot address such a path — it demonstrably can, which is exactly the problem.
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/u;
const BOUNDARY_SPACE = /^ | $/u;
const QUERY_OR_FRAGMENT = /[?#]/u;
const NOT_FOUND = -1;
const HEX_WIDTH = 4;
const HEX_RADIX = 16;

// Names the offending character by code point rather than echoing the url: the url carries a
// control character by definition, and this message reaches a terminal. The offset is a zero-based
// index into the url with any `git+` prefix already removed.
const controlCharacterMessage = (cloneUrl: string, at: number): string => {
  /* v8 ignore next -- `at` came from a match on this same string, so the index is in range; the
     fallback exists because the return type cannot say so. */
  const code = cloneUrl.codePointAt(at) ?? 0;
  const point = `U+${code.toString(HEX_RADIX).toUpperCase().padStart(HEX_WIDTH, '0')}`;
  return `not a supported git url: control character ${point} at position ${String(at)}`;
};

/** Every check that must run against the RAW url, before the WHATWG parser normalizes it away. */
const assertSafeRawUrl = (cloneUrl: string, input: string): void => {
  const at = cloneUrl.search(CONTROL_CHARACTER);
  if (at !== NOT_FOUND) {
    throw validationError(controlCharacterMessage(cloneUrl, at));
  }
  if (BOUNDARY_SPACE.test(cloneUrl)) {
    throw validationError('not a supported git url: leading or trailing space');
  }
  if (QUERY_OR_FRAGMENT.test(cloneUrl)) {
    throw validationError(`not a supported git url: query or fragment in ${redactUrl(input)}`);
  }
  assertNoBackslash(cloneUrl, input);
  assertNoDotSegment(cloneUrl, input);
};

const assertNoBackslash = (cloneUrl: string, input: string): void => {
  if (hasBackslash(cloneUrl)) {
    throw validationError(`not a supported git url: backslash not allowed in ${redactUrl(input)}`);
  }
};

const assertNoDotSegment = (cloneUrl: string, input: string): void => {
  if (hasDotSegment(cloneUrl)) {
    throw validationError(`not a supported git url: path traversal segment in ${redactUrl(input)}`);
  }
};

// Percent-encoding is only meaningful for `file:` urls (which encode filesystem-legal characters
// like spaces); https/ssh forms never need it, so any `%` there is rejected.
const assertNoPercentEncodingUnlessFile = (url: URL, cloneUrl: string, input: string): void => {
  if (url.protocol !== 'file:' && hasPercentEncoding(cloneUrl)) {
    throw validationError(
      `not a supported git url: percent-encoding not supported in ${redactUrl(input)}`,
    );
  }
};

export { assertNoPercentEncodingUnlessFile, assertSafeRawUrl, hasPercentEncoding };
