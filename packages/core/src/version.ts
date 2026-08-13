// Ordering for plain `x.y.z` versions, shared by the two places that need it: the doctor check that
// compares the installed skill's pin against this CLI, and the one that compares this CLI against
// npm's `latest`.

// Guards the split because `Number` is far more permissive than the `x.y.z` this ever means:
// `Number('0x2') === 2` would let `1.0x2.3` through as `[1, 2, 3]`, and `Number('') === 0` would
// let `1..3` through as `[1, 0, 3]`.
const PLAIN_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

const LEADING_ZEROS_PATTERN = /^0+(?=\d)/u;

const LESS = -1;
const EQUAL = 0;
const GREATER = 1;

/** Orders two digit strings exactly, at any length. Components are compared by length first (after
 * stripping leading zeros, so `007` and `7` are equal) and only then lexicographically — converting
 * to `Number` instead would silently misorder any component past 2^53. */
const compareDigits = (left: string, right: string): number => {
  const leftDigits = left.replace(LEADING_ZEROS_PATTERN, '');
  const rightDigits = right.replace(LEADING_ZEROS_PATTERN, '');
  if (leftDigits.length !== rightDigits.length) {
    return leftDigits.length < rightDigits.length ? LESS : GREATER;
  }
  if (leftDigits === rightDigits) {
    return EQUAL;
  }
  return leftDigits < rightDigits ? LESS : GREATER;
};

/**
 * Compares two plain `x.y.z` versions: negative when `left` precedes `right`, `0` when they are
 * equal, positive when `left` follows it.
 *
 * Returns `undefined` when either side is not plain `x.y.z` — a prerelease (`1.2.3-rc.1`) or build
 * metadata included. Ordering those is a genuinely different problem, and a caller that cannot
 * order a pair should say so rather than act on a guess.
 */
const comparePlainVersions = (left: string, right: string): number | undefined => {
  if (!PLAIN_VERSION_PATTERN.test(left) || !PLAIN_VERSION_PATTERN.test(right)) {
    return undefined;
  }
  const leftParts = left.split('.');
  const rightParts = right.split('.');
  const decided = leftParts
    .map((part, index) => compareDigits(part, rightParts[index] ?? ''))
    .find((result) => result !== EQUAL);
  return decided ?? EQUAL;
};

export { comparePlainVersions, PLAIN_VERSION_PATTERN };
