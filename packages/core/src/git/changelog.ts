import type { Runner } from '../proc/runner.ts';
import { showFileAtTag } from './range.ts';

// CHANGELOG excerpt extraction for `refs range` — split out of range.ts (the bounded git range
// Queries) purely to keep that file under the repo's 300-line cap. The heuristic is deliberately
// Conservative: an excerpt is only ever the slice between two version HEADINGS (or the char cap),
// And when the new version's heading cannot be found at all the result is `undefined` — never a
// Dump of the whole file into the CLI envelope.

interface ChangelogExcerptOpts {
  maxChars: number;
  newVersion: string;
  oldVersion: string;
}

interface ChangelogQuery extends ChangelogExcerptOpts {
  newTag: string;
  packagePath?: string;
}

interface ChangelogExcerpt {
  excerpt: string;
  truncated: boolean;
}

const NOT_FOUND_INDEX = -1;
const NEXT_LINE = 1;
const EXCERPT_START = 0;
const CHANGELOG_BASENAME = 'CHANGELOG.md';

// Escapes every ECMAScript regex metacharacter so a version string is always matched literally
// (real versions contain `.`; prerelease tags can carry `+` build metadata).
const REGEX_METACHARS = /[$()*+.?[\\\]^{|}]/gu;
const escapeForRegex = (value: string): string => value.replace(REGEX_METACHARS, String.raw`\$&`);

// A "version heading" is a markdown ATX heading line containing the version BOUNDED on both
// Sides: not preceded by `[0-9.]` (so `## 14.0.0` never matches version `4.0.0`) and not
// Followed by `[0-9A-Za-z-]` (so `## 4.0.0-rc.1` never matches `4.0.0`) — while `## [4.0.0]`,
// `## v4.0.0`, and `## 4.0.0 (2026-04-02)` all still do.
const versionHeadingPattern = (version: string): RegExp =>
  new RegExp(`(?<![0-9.])${escapeForRegex(version)}(?![0-9A-Za-z-])`, 'u');

const isVersionHeading = (line: string, versionPattern: RegExp): boolean =>
  line.startsWith('#') && versionPattern.test(line);

const sectionEndIndex = (
  lines: readonly string[],
  start: number,
  oldVersionPattern: RegExp,
): number => {
  const relative = lines
    .slice(start + NEXT_LINE)
    .findIndex((line) => isVersionHeading(line, oldVersionPattern));
  if (relative === NOT_FOUND_INDEX) {
    return lines.length;
  }
  return start + NEXT_LINE + relative;
};

/** Slices the section from the heading matching `newVersion` (bounded, per
 * `versionHeadingPattern`) up to (excluding) the heading matching `oldVersion` — or to
 * end-of-file when the old heading is absent — then applies the char cap. `undefined` (never the
 * whole file) when no heading matches `newVersion` at all. */
const extractChangelogExcerpt = (
  content: string,
  opts: ChangelogExcerptOpts,
): ChangelogExcerpt | undefined => {
  const lines = content.split('\n');
  const newHeading = versionHeadingPattern(opts.newVersion);
  const start = lines.findIndex((line) => isVersionHeading(line, newHeading));
  if (start === NOT_FOUND_INDEX) {
    return undefined;
  }
  const oldHeading = versionHeadingPattern(opts.oldVersion);
  const section = lines.slice(start, sectionEndIndex(lines, start, oldHeading)).join('\n');
  if (section.length <= opts.maxChars) {
    return { excerpt: section, truncated: false };
  }
  return { excerpt: section.slice(EXCERPT_START, opts.maxChars), truncated: true };
};

const changelogCandidates = (packagePath: string | undefined): string[] => {
  if (packagePath === undefined || packagePath === '.') {
    return [CHANGELOG_BASENAME];
  }
  // Git paths are always '/'-separated regardless of platform; `zPackagePath` guarantees a
  // Normalized relative posix path, so plain concatenation is correct here.
  return [`${packagePath}/${CHANGELOG_BASENAME}`, CHANGELOG_BASENAME];
};

/** The bounded CHANGELOG excerpt for `query.newTag`: tries `<packagePath>/CHANGELOG.md` first
 * (when a package scope is given), then the repo-root `CHANGELOG.md` — each read AT the new tag,
 * not the working tree. `undefined` when no candidate exists or none mentions the new version. */
const changelogAtTag = async (
  runner: Runner,
  dir: string,
  query: ChangelogQuery,
): Promise<ChangelogExcerpt | undefined> => {
  for (const path of changelogCandidates(query.packagePath)) {
    // eslint-disable-next-line no-await-in-loop -- candidates are ordered (package first, then root); the fallback read must not fire when the earlier candidate already matched
    const content = await showFileAtTag(runner, dir, { path, tag: query.newTag });
    if (content !== undefined) {
      const excerpt = extractChangelogExcerpt(content, query);
      if (excerpt !== undefined) {
        return excerpt;
      }
    }
  }
  return undefined;
};

export { changelogAtTag, extractChangelogExcerpt };
export type { ChangelogExcerpt, ChangelogExcerptOpts, ChangelogQuery };
