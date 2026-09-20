import type { TagFormat } from '../schemas/primitives.ts';
import { renderTag } from './tags.ts';
import { zTagFormat } from '../schemas/primitives.ts';

// Deriving a tag format from ONE version that is known to belong to a package, rather than from
// how often a shape occurs (`detectTagFormat` in `tags.ts`, which stays as it is and stays the
// fallback).
//
// Counting answers "what do most of this repository's tags look like", which is a different
// question from "how does this package tag its releases" and gives a different answer whenever the
// package asked about is not the most-tagged one. Measured: `Effect-TS/effect` has 63 `effect@…`
// tags against 668 `@effect/platform-node@…`, so the count named the sibling; `withastro/astro`
// named `astro@{version}` for every package including `@astrojs/react`; `kysely-org/kysely` named
// the bare `{version}` its older releases used, which no current release carries.
//
// Nothing here is Node-specific: it takes tags, a version string and a name. Only the CALLER knows
// where a version comes from, and today that is a `package.json` in the checkout — so a repository
// without one keeps the counted answer, which for `gin`, `serde`, `requests` and `tokio` was
// already the right one.

/** A bounded shape filter, not SemVer validation — it admits leading zeros and empty dotted
 * identifiers, and does not care. A version is used to pick a tag and is then thrown away; what it
 * has to be is short, free of anything that could not be part of a tag name, and recognisably a
 * version rather than whatever else a manifest puts in the field. */
const VERSION_SHAPE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/u;
const MAX_VERSION_LENGTH = 64;

/** A version triple anywhere in the PREFIX, which `tryDeriveFormat` rejects a tag for too (see
 * `tags.ts`). `compare-1.2.3-to-1.2.3` anchors on `1.2.3` and would otherwise store
 * `compare-1.2.3-to-{version}` — a format that keeps one version pinned inside it forever. */
const BARE_VERSION = /\d+\.\d+\.\d+/u;

/** The anchor. A prefix ending in a digit or a dot means the version sits INSIDE a longer number,
 * not at its own boundary: `v1.2.0.0` ends with `2.0.0` and has nothing to do with it. */
const NUMERIC_TAIL = /[0-9.]$/u;

/** Separators a repository puts between a package name and its version. Exact membership, never
 * character trimming: stripping a trailing `@-_/` turns `dev@` into `de` and `foo-v` into `foo`,
 * and both then compare equal to a package that exists. The name is matched in full for the same
 * reason — an unscoped alias would let a sibling literally named `core` claim `@acme/core`'s tags.
 * Measured over 242 package/repository pairs, the alias was never what found the answer. */
const SEPARATORS = ['@', '-', '_', '/'] as const;
const VERSION_MARKER = 'v';
const PLACEHOLDER = '{version}';

/** The prefix names the package. */
const RANK_NAMED = 2;
/** The prefix is the repository-wide `v` or nothing at all — right for a single-package repo, and
 * for the one package a monorepo tags without naming. */
const RANK_GENERIC = 1;
/** Some other package's name, or a prefix nothing here recognises. Never an answer: a tag carrying
 * this version under a DIFFERENT package's name is the very mistake counting made. Measured, every
 * one of the eight such matches in the corpus was wrong — `astro-benchmark` would have been given
 * `@astrojs/netlify@{version}`. */
const RANK_OTHER = 0;

type Ranked = {
  format: TagFormat;
  rank: number;
};

/** Whether `prefix` is this package's name followed by a separator, optionally then a `v`. */
const namesPackage = (prefix: string, name: string): boolean =>
  SEPARATORS.some(
    (sep) => prefix === `${name}${sep}` || prefix === `${name}${sep}${VERSION_MARKER}`,
  );

/** Whether `format` puts this package's name in front of the version, rather than the bare `v` any
 * release in the repository might carry.
 *
 * The caller needs this because the two are worth different things. For a repository's own format,
 * a `v` prefix is the answer (`kysely-org/kysely` tags `v0.29.5` and nothing else). For one
 * package inside a monorepo it is not evidence about that package at all: `vercel/next.js` carries
 * a bare `1.0.0` tag from 2016, and a private benchmark package happens to declare version
 * `1.0.0` — measured, that was the only per-package override in five real repositories that a
 * name check would have removed, and the thirty it keeps are all correct. */
const tagFormatNamesPackage = (format: TagFormat, packageName: string): boolean =>
  namesPackage(format.slice(0, format.length - PLACEHOLDER.length), packageName) &&
  format.endsWith(PLACEHOLDER);

const rankOf = (prefix: string, packageName: string | undefined): number => {
  if (packageName !== undefined && namesPackage(prefix, packageName)) {
    return RANK_NAMED;
  }
  return prefix === '' || prefix === VERSION_MARKER ? RANK_GENERIC : RANK_OTHER;
};

/** What `tag` puts in front of `version`, when it ends in exactly that version at a boundary. */
const prefixBefore = (tag: string, version: string): string | undefined => {
  if (!tag.endsWith(version)) {
    return undefined;
  }
  const prefix = tag.slice(0, tag.length - version.length);
  return NUMERIC_TAIL.test(prefix) || BARE_VERSION.test(prefix) ? undefined : prefix;
};

const candidateFrom = (
  tag: string,
  version: string,
  packageName: string | undefined,
): Ranked | undefined => {
  const prefix = prefixBefore(tag, version);
  if (prefix === undefined) {
    return undefined;
  }
  const parsed = zTagFormat.safeParse(`${prefix}${PLACEHOLDER}`);
  if (!parsed.success) {
    return undefined;
  }
  // Not redundant with building the format out of the prefix: a tag that literally contains
  // `{version}` in front of its version produces a format with two placeholders, and rendering it
  // then yields something other than the tag it came from.
  if (renderTag(parsed.data, version) !== tag) {
    return undefined;
  }
  return { format: parsed.data, rank: rankOf(prefix, packageName) };
};

/** The single format at the highest rank present, or `null` when that rank holds more than one.
 *
 * Ambiguity is reported rather than broken by a tiebreak. Two different formats both naming this
 * package at the same version is a convention refs cannot read off the repository, and a coin flip
 * there writes a wrong format into a config that nobody will look at again. */
const bestOf = (candidates: readonly Ranked[]): TagFormat | null => {
  const ranked = candidates.filter((candidate) => candidate.rank > RANK_OTHER);
  const top = ranked.reduce((best, candidate) => Math.max(best, candidate.rank), RANK_OTHER);
  const formats = new Set(
    ranked.filter((candidate) => candidate.rank === top).map((candidate) => candidate.format),
  );
  const [only] = [...formats];
  // eslint-disable-next-line unicorn/no-null -- public API returns `TagFormat | null`
  return formats.size === 1 && only !== undefined ? only : null;
};

/**
 * The format `tags` uses for `version`, which is a version `packageName` is known to be AT.
 *
 * The caller supplies evidence rather than a guess: this returns a format only for a tag that
 * exists and ends in exactly that version at a digit boundary, so the answer is always a real tag
 * the repository wrote, re-expressed with `{version}` in place of the version it carried.
 *
 * `packageName` decides between tags that all carry the version — a monorepo releasing every
 * package together has one per package. A prefix naming that package wins; the bare `v` or no
 * prefix at all is accepted where nothing names it; a prefix naming a DIFFERENT package is never
 * an answer. `null` when nothing anchors, or when the winning rank holds more than one format;
 * both mean the caller should fall back to `detectTagFormat`.
 */
const detectTagFormatForVersion = (
  tags: readonly string[],
  version: string,
  packageName?: string,
): TagFormat | null => {
  if (version.length > MAX_VERSION_LENGTH || !VERSION_SHAPE.test(version)) {
    // eslint-disable-next-line unicorn/no-null -- public API returns `TagFormat | null`
    return null;
  }
  // An empty list falls straight out of `bestOf` as `null` — no separate guard, so there is one
  // place that decides what "nothing usable" means.
  return bestOf(
    tags
      .map((tag) => candidateFrom(tag, version, packageName))
      .filter((candidate) => candidate !== undefined),
  );
};

export { detectTagFormatForVersion, tagFormatNamesPackage };
