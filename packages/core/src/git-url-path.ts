// The two path-shaping helpers `git-url.ts` applies to a url's pathname before it becomes a ref
// key. Split out for the same reason as `git-url-redact.ts`: the parent file sat exactly on the
// repo's 300-line cap, and the trim below needed a paragraph of explanation it could not host.

const GIT_SUFFIX_PATTERN = /\.git$/u;
const PATH_SEPARATOR = '/';

const stripGitSuffix = (path: string): string => path.replace(GIT_SUFFIX_PATTERN, '');

/** Strips leading and trailing `/` from a url path.
 *
 * Scanned by index rather than written as `.replace(/^\/+/u, '').replace(/\/+$/u, '')`. The
 * trailing form is quadratic — anchored at the end, the engine retries a run of slashes from every
 * position and backtracks through it each time — and the paths reaching here come from a remote npm
 * packument's `repository.url`, which a stranger writes. CodeQL reports it as
 * `js/polynomial-redos`.
 *
 * The run has to sit in the MIDDLE of the path to bite: one at the end matches in a single pass,
 * and leading slashes are gone before the trailing pattern is reached. Such a url is rejected
 * either way, but only after the trim has already run. The measurement is in the test. */
const trimPathSlashes = (path: string): string => {
  let start = 0;
  let end = path.length;
  while (start < end && path.charAt(start) === PATH_SEPARATOR) {
    start += 1;
  }
  while (end > start && path.charAt(end - 1) === PATH_SEPARATOR) {
    end -= 1;
  }
  return path.slice(start, end);
};

export { stripGitSuffix, trimPathSlashes };
