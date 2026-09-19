import type { PackageEntry } from '@kaisers-io/refs-core';

// The segment-prefix walk and the package lookup `--ref` routing performs, split from
// `resolve-route.ts` for the 300-line cap. Nothing about either changed.

/** Decreasing-length segment prefixes of `query`, longest first, excluding the full string (which
 * the caller has already tried as an exact match). Yielding longest-first is what makes the FIRST
 * hit necessarily the longest one, so `react/jsx-runtime` resolves to `react` and
 * `@scope/pkg/sub/path` to `@scope/pkg` without hard-coding scoped-vs-unscoped segment counts.
 *
 * One definition, used by both the unscoped search and the `--ref`-scoped one, so the two cannot
 * disagree about what an import path means. */
const segmentPrefixes = function* segmentPrefixes(query: string): Generator<string> {
  const segments = query.split('/');
  for (let length = segments.length - 1; length >= 1; length -= 1) {
    yield segments.slice(0, length).join('/');
  }
};

// `Object.hasOwn` rather than bracket access, and it matters most here: `routeWithinRef` passes a
// `{}` literal when a ref declares no packages table, and that literal carries `Object.prototype`
// however the schema built the real record. Measured before this changed:
// `refs resolve toString --ref <ref>` matched `Object.prototype.toString`, and reading `.path` off
// it crashed the command with an `unexpected` error. Both lookups need it — the prefix loop asks
// the same question of every segment prefix, so `toString/subpath` reached it just as directly.
const packageWithin = (
  packages: Readonly<Record<string, PackageEntry>>,
  query: string,
): { entry: PackageEntry; name: string } | undefined => {
  const exact = Object.hasOwn(packages, query) ? packages[query] : undefined;
  if (exact !== undefined) {
    return { entry: exact, name: query };
  }
  for (const candidate of segmentPrefixes(query)) {
    const found = Object.hasOwn(packages, candidate) ? packages[candidate] : undefined;
    if (found !== undefined) {
      return { entry: found, name: candidate };
    }
  }
  return undefined;
};

export { packageWithin, segmentPrefixes };
