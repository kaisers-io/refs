import type { Runner } from '../proc/runner.ts';
import type { TagFormat } from '../schemas/primitives.ts';
import { notFoundError } from '../errors.ts';
import { tagExists } from './repo.ts';
import { zTagFormat } from '../schemas/primitives.ts';

// Regex for semantic version: major.minor.patch with optional prerelease and optional build metadata.
// Dots are allowed in both the prerelease and build parts, per SemVer spec §9
// (e.g. `1.0.0-alpha.1`, `v15.0.0-canary.28`).
const SEMVER = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/u;
// Bare major.minor.patch triple (no prerelease/build), used only to detect a second
// Embedded semver.
//
// SEMVER's greedy prerelease/build match can swallow a trailing "-word-N.N.N" whole
// (e.g. `compare-1.2.3-to-2.0.0` matches as a single span, `1.2.3-to-2.0.0`), so
// Checking the leftover after replacement would miss it. Counting bare N.N.N triples
// In the original tag catches it instead: two non-overlapping triples means the tag
// Embeds two versions and is not reliably derivable.
const BARE_VERSION = /\d+\.\d+\.\d+/gu;
const MAX_UNAMBIGUOUS_VERSION_COUNT = 1;

/** Validates that a derived format is acceptable. */
const isValidFormat = (format: string): boolean => {
  const validation = zTagFormat.safeParse(format);
  return validation.success;
};

/** True if the tag embeds more than one bare major.minor.patch triple, making it ambiguous. */
const hasMultipleEmbeddedVersions = (tag: string): boolean => {
  const bareMatches = tag.match(BARE_VERSION);
  return bareMatches !== null && bareMatches.length > MAX_UNAMBIGUOUS_VERSION_COUNT;
};

/** Attempts to derive a tag format from a single tag by replacing semver with {version}. */
const tryDeriveFormat = (tag: string): string | undefined => {
  const match = SEMVER.exec(tag);

  if (!match) {
    return undefined;
  }

  // Reject tags that embed more than one bare major.minor.patch triple — these are
  // Not reliably derivable (e.g. `compare-1.2.3-to-2.0.0` embeds both 1.2.3 and 2.0.0).
  if (hasMultipleEmbeddedVersions(tag)) {
    return undefined;
  }

  const [semverMatch] = match;
  const format = tag.replace(semverMatch, '{version}');

  if (!isValidFormat(format)) {
    return undefined;
  }

  return format;
};

type FormatCandidate = {
  count: number;
  index: number;
};

/** Increments format count in the frequency map. */
const incrementFormatCount = (
  counts: Map<string, FormatCandidate>,
  format: string,
  index: number,
): void => {
  const existing = counts.get(format);
  if (existing === undefined) {
    counts.set(format, { count: 1, index });
  } else {
    existing.count += 1;
  }
};

/** Builds a frequency map of formats from tags. */
const buildFormatCounts = (tags: readonly string[]): Map<string, FormatCandidate> => {
  const counts = new Map<string, FormatCandidate>();

  for (const [idx, tag] of tags.entries()) {
    const format = tryDeriveFormat(tag);
    if (format) {
      incrementFormatCount(counts, format, idx);
    }
  }

  return counts;
};

/** Compares two format candidates to determine the best one. */
const isBetter = (newCandidate: FormatCandidate, bestCandidate: FormatCandidate): boolean =>
  newCandidate.count > bestCandidate.count ||
  (newCandidate.count === bestCandidate.count && newCandidate.index < bestCandidate.index);

/** Finds the most frequent format; on a tie, the earliest index (most recent) wins. */
const findBestFormat = (formatCounts: Map<string, FormatCandidate>): string | null => {
  const entries = [...formatCounts.entries()];
  const [firstEntry] = entries;
  if (firstEntry === undefined) {
    // eslint-disable-next-line unicorn/no-null -- public API returns `TagFormat | null`
    return null;
  }

  const [best, firstCandidate] = firstEntry;
  return entries.slice(1).reduce(
    ({ format: fmt, data: current }, [candidate, data]) => {
      if (isBetter(data, current)) {
        return { data, format: candidate };
      }

      return { data: current, format: fmt };
    },
    { data: firstCandidate, format: best },
  ).format;
};

/**
 * Detects the dominant tag format from a list of recent tags (newest-first from git tag --sort=-version:refname).
 * Replaces the first semver substring in each tag with {version}; tags without semver are ignored.
 * Groups identical formats and returns the most frequent; on a tie, the most recent tag wins.
 * Returns null if no valid formats are found.
 */
const detectTagFormat = (tags: readonly string[]): TagFormat | null => {
  const formatCounts = buildFormatCounts(tags);
  const best = findBestFormat(formatCounts);
  return best as TagFormat | null;
};

/**
 * Renders a tag by replacing {version} with the provided version string.
 * Uses a replacer function to avoid $ pattern interpretation in String.replace,
 * and replaceAll to handle multiple {version} placeholders.
 */
const renderTag = (format: TagFormat, version: string): string =>
  format.replaceAll('{version}', () => version);

/**
 * Resolves a tag by rendering it with the provided version and verifying it exists.
 * Throws notFoundError if the tag does not exist.
 */
// eslint-disable-next-line max-params -- exported API: (runner, dir, format, version) is the established call signature
const resolveTag = async (
  runner: Runner,
  dir: string,
  format: TagFormat,
  version: string,
): Promise<string> => {
  const tag = renderTag(format, version);
  const exists = await tagExists(runner, dir, tag);

  if (!exists) {
    throw notFoundError(`tag '${tag}' not found in ${dir} — check the version or tag_format`);
  }

  return tag;
};

export { detectTagFormat, renderTag, resolveTag };
