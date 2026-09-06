// IO orchestration for workspace package detection: which patterns survive a declaration's
// negations, and shaping the result. Turning one pattern into directories lives in
// `workspaces-expand.ts`; which shapes exist at all, in `workspaces-shapes.ts`.
import type {
  WorkspaceDiagnostic,
  WorkspacePackage,
  WorkspaceScan,
} from './workspaces-patterns.ts';
import {
  classifyWorkspacePattern,
  isNegatedPattern,
  negatedBody,
  normalizeSeparators,
  planMatchesPath,
} from './workspaces-shapes.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { deduplicateAndSort, sortDiagnostics } from './workspaces-patterns.ts';
import { partitionProbes, probePackageDir } from './workspaces-probe.ts';
import { probeRootPackage, withoutClaimedRoot } from './workspaces-root.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { ExpandResult } from './workspaces-probe.ts';
import { expandGlobPattern } from './workspaces-expand.ts';
import { readDeclarations } from './workspaces-declarations.ts';

/** Whether `pattern`, read as a path, is what `negation` names.
 *
 * This is npm's re-inclusion test, and it is about the PATTERN STRING rather than the directories
 * it selects — `appendNegatedPatterns` in `@npmcli/map-workspaces` runs `minimatch(pattern,
 * negatedPattern)`. The difference is visible: after `!packages/cli`, a later literal
 * `packages/cli` cancels the exclusion, while a later `packages/*` does not, even though it
 * selects that same directory. Verified against that resolver for both. */
const cancels = (pattern: string, negation: string): boolean =>
  planMatchesPath(classifyWorkspacePattern(negatedBody(negation)), normalizeSeparators(pattern));

type Selection = { negations: string[]; patterns: string[] };

/** npm's `appendNegatedPatterns`, for the shapes this scanner supports.
 *
 * Walk the declaration in order. A negation is remembered. A positive pattern first CANCELS every
 * remembered negation it names, then joins the list — which is why order and repetition both
 * matter, and why the declaration reaches here as a list rather than a set.
 *
 * npm then drops any pattern a surviving negation names, before globbing. That step is an
 * optimization there ("to avoid unnecessary crawling") and redundant here, because the same
 * negations are applied to the expanded directories anyway — a literal pattern for an excluded
 * directory returns nothing either way. Left out rather than carried as logic no test can
 * distinguish. */
const selectPatterns = (declared: readonly string[]): Selection =>
  declared.reduce<Selection>(
    (state, pattern) =>
      isNegatedPattern(pattern)
        ? { negations: [...state.negations, pattern], patterns: state.patterns }
        : {
            // Every remembered negation this pattern NAMES is cancelled by it.
            negations: state.negations.filter((negation) => !cancels(pattern, negation)),
            patterns: [...state.patterns, pattern],
          },
    { negations: [], patterns: [] },
  );

/** Whether a surviving negation names this directory. Decided from the plans alone, so it can be
 * applied before a candidate's manifest is ever opened — an excluded directory must not be able to
 * contribute a diagnostic about a package nobody asked for. */
const excludedBy = (negations: readonly string[], dir: string): boolean =>
  negations.some((negation) =>
    planMatchesPath(classifyWorkspacePattern(negatedBody(negation)), dir),
  );

/** A negation nobody can expand is reported, exactly as an unexpandable inclusive pattern is: the
 * scan then holds directories the repository excluded, and nothing in it can be shown to be a
 * member. */
const unexpandableNegations = (negations: readonly string[]): WorkspaceDiagnostic[] =>
  negations
    .filter((negation) => classifyWorkspacePattern(negatedBody(negation)).kind === 'ignore')
    .map((negation) => ({ kind: 'unsupported_pattern', pattern: negation }));

const collect = (results: readonly ExpandResult[]): ExpandResult => {
  const dirs = new Set<string>();
  const diagnostics: WorkspaceDiagnostic[] = [];
  for (const result of results) {
    result.dirs.forEach((dir) => dirs.add(dir));
    diagnostics.push(...result.diagnostics);
  }
  return { diagnostics, dirs: [...dirs] };
};

const expandPatterns = async (
  repoDir: string,
  declared: readonly string[],
): Promise<ExpandResult> => {
  const { negations, patterns } = selectPatterns(declared);
  const excluded = { has: (dir: string): boolean => excludedBy(negations, dir) };
  const chosen = collect(
    await Promise.all(
      patterns.map((pattern) =>
        expandGlobPattern(repoDir, { body: pattern, declared: pattern }, excluded),
      ),
    ),
  );
  return {
    diagnostics: [...chosen.diagnostics, ...unexpandableNegations(negations)],
    dirs: chosen.dirs,
  };
};

const detectWorkspacePackagesDetailed = async (repoDir: string): Promise<WorkspaceScan> => {
  const declared = await readDeclarations(repoDir);
  if (declared.patterns.length === 0) {
    // No workspaces declared: an ordinary single-package repo, whose empty scan is the correct
    // answer and whose `no_workspace_declaration` diagnostic is what stops a caller concluding
    // anything from it. The root is deliberately NOT probed here — `refs add`'s npm fallback owns
    // this shape, registering the package at the packument's directory or `.`, and a root probe
    // would suppress that fallback with a locator it did not choose.
    return {
      diagnostics: sortDiagnostics([...declared.diagnostics, { kind: 'no_workspace_declaration' }]),
      packages: [],
    };
  }

  const expansion = await expandPatterns(repoDir, declared.patterns);
  const [root, expanded] = await Promise.all([
    probeRootPackage(repoDir),
    Promise.all(expansion.dirs.map((dir) => probePackageDir(repoDir, dir))),
  ]);
  const partitioned = partitionProbes([...root, ...expanded]);

  return {
    diagnostics: sortDiagnostics([
      ...declared.diagnostics,
      ...expansion.diagnostics,
      ...partitioned.diagnostics,
    ]),
    packages: withoutClaimedRoot(deduplicateAndSort(partitioned.packages)),
  };
};

/** Best-effort detection, unchanged: the exact shape `refs add` has always consumed.
 * Diagnostics are deliberately dropped here — `add` is best-effort by design and has an agent to
 * fill any gaps. */
const detectWorkspacePackages = async (repoDir: string): Promise<WorkspacePackage[]> => {
  const scan = await detectWorkspacePackagesDetailed(repoDir);
  return scan.packages;
};

export { detectWorkspacePackages, detectWorkspacePackagesDetailed };
export { readRootPackage, withoutClaimedRoot } from './workspaces-root.ts';
// Re-exported here rather than from `workspaces-patterns.ts` directly: a consumer that gets a
// scan from this module needs the predicate that says whether it may be trusted, and the two
// belong together in the public surface.
export { scanIsReliable, scanSearchedSomewhere } from './workspaces-patterns.ts';
export type {
  WorkspaceDiagnostic,
  WorkspacePackage,
  WorkspaceScan,
} from './workspaces-patterns.ts';
