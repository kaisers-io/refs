import type { WorkspaceDiagnostic, WorkspaceScan } from './workspaces-patterns.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { UNRELIABLE_DIAGNOSTIC_KINDS } from './workspaces-patterns.ts';

// What a scan's diagnostics actually permit a caller to claim.
//
// `scanIsReliable` (workspaces-patterns.ts) answers the strict question — was the declaration
// expanded faithfully? This file answers the useful one: could the scan have MISSED a package?
// The two come apart on exactly one diagnostic, and the difference decides whether the drift
// probe says anything at all on a real monorepo.

const NEGATION_PREFIX = '!';

/** A dropped NEGATION is the one unsupported shape that cannot hide a package.
 *
 * Unsupported patterns are dropped rather than expanded. For `**` or a traversal that means
 * directories go unvisited — the scan may be a SUBSET of the real membership, so nothing about
 * "only here" or "nowhere" survives it. A negation is the opposite: dropping `!examples/vue/2*`
 * leaves the directories it would have excluded in the scan, making it a SUPERSET. Nothing is
 * hidden; some of what is there simply is not a member.
 *
 * The distinction is load-bearing on real repositories. TanStack Query declares two negations, and
 * treating them like any other unsupported pattern silenced every finding about every one of its
 * hundred packages. */
const isNegation = (diagnostic: WorkspaceDiagnostic): boolean =>
  diagnostic.kind === 'unsupported_pattern' && diagnostic.pattern.startsWith(NEGATION_PREFIX);

/** Whether the scan could have MISSED a package — the question behind every claim about all paths
 * ("it is nowhere", "it is only here"). Weaker than `scanIsReliable`, which also refuses a scan
 * that merely holds too much. */
const scanMayHidePackages = (scan: WorkspaceScan): boolean =>
  scan.diagnostics.some(
    (diagnostic) => UNRELIABLE_DIAGNOSTIC_KINDS.has(diagnostic.kind) && !isNegation(diagnostic),
  );

/** The literal path prefix of each dropped negation — everything up to its first wildcard.
 *
 * `!examples/vue/2*` yields `examples/vue/2`, which no path outside that subtree can start with.
 * A package under one of these prefixes may have been excluded on purpose, so it must not be
 * recommended for registration; every other package in the scan is unaffected. */
const negatedPrefixes = (scan: WorkspaceScan): string[] =>
  scan.diagnostics
    .filter((diagnostic) => isNegation(diagnostic))
    .map(
      (diagnostic) =>
        (diagnostic as { pattern: string }).pattern.slice(NEGATION_PREFIX.length).split('*')[0],
    )
    .filter((prefix): prefix is string => prefix !== undefined && prefix.length > 0);

export { negatedPrefixes, scanMayHidePackages };
