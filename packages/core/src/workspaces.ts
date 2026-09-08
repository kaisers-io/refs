// IO orchestration for workspace package detection: which patterns survive a declaration's
// negations, and shaping the result. Turning one pattern into directories lives in
// `workspaces-expand.ts`; which shapes exist at all, in `workspaces-shapes.ts`.
//
// HOW EXACT THIS HAS TO BE, because the question has no natural end otherwise. npm's workspace
// resolution is a large surface and this file emulates part of it; the stopping rule is the
// DIRECTION a divergence errs in, not how many shapes are covered.
//
//   - Missing a package the repository declares is a real defect. `refs resolve` then answers
//     `not_found` for source that is right there, which is the failure this whole tool exists to
//     prevent. The re-inclusion rule and the `!!` handling are here for that reason.
//   - Including one the repository excludes is tolerated. The entry points at a real directory
//     holding a real manifest, in a repository the user asked to track; the cost is an extra
//     routing target, not a wrong answer.
//
// Known divergences, all of the tolerated kind, measured against `@npmcli/map-workspaces`:
//
//   ["packages/*", "!packages/./core"]                             npm: (none)   here: core
//   ["packages/*", "!packages/core", "!packages/core", "packages/core"]
//                                                                  npm: (none)   here: core
//
// The first is `.` inside a pattern rather than at its start; the second is npm cancelling only
// ONE of a repeated exclusion. Fixing either would add emulation for no behavioural gain. A review
// finding in this direction is a note for this list, not a change.
import type {
  WorkspaceDiagnostic,
  WorkspacePackage,
  WorkspaceScan,
} from './workspaces-patterns.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { deduplicateAndSort, sortDiagnostics } from './workspaces-patterns.ts';
import { isNegatedPattern, matchesPattern, negatedBody } from './workspaces-shapes.ts';
import { partitionProbes, probePackageDir } from './workspaces-probe.ts';
import { probeRootPackage, withoutClaimedRoot } from './workspaces-root.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { ExpandResult } from './workspaces-probe.ts';
import { expandGlobPattern } from './workspaces-expand.ts';
import { readDeclarations } from './workspaces-declarations.ts';

/** Whether `pattern`, read as a path, is what `negation` names.
 *
 * npm's re-inclusion test, run the way npm runs it: `appendNegatedPatterns` in
 * `@npmcli/map-workspaces` calls `minimatch(pattern, negatedPattern)` — the positive pattern is
 * matched AS A PATH against the negation. The difference from matching selected directories is
 * visible: after `!packages/cli`, a later literal `packages/cli` cancels the exclusion, while a
 * later `packages/*` does not, though it selects that same directory.
 *
 * Calling the same matcher is what makes the trailing-slash asymmetry fall out rather than need
 * restating: `minimatch('packages/cli/', 'packages/cli')` is true, the reverse is false. */
const cancels = (pattern: string, negation: string): boolean =>
  matchesPattern(negatedBody(pattern), negatedBody(negation));

type Selection = { negations: string[]; patterns: string[] };

/** pnpm's rule: a negation is an ignore, and nothing takes it back.
 *
 * `find-packages` hands the declaration to tinyglobby, where `!packages/cli` filters the results
 * and a later `packages/cli` does not reinstate it. Verified against pnpm itself: for
 * `['packages/*', '!packages/cli', 'packages/cli']` it reports only the other package, where npm
 * reports both. */
const selectPnpmPatterns = (declared: readonly string[]): Selection => ({
  negations: declared.filter((pattern) => isNegatedPattern(pattern)),
  patterns: declared.filter((pattern) => !isNegatedPattern(pattern)),
});

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
const selectPatterns = (declared: readonly string[]): Selection => {
  const walked = declared.reduce<Selection>(
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
  return {
    negations: walked.negations,
    // npm's last step: a positive pattern that a SURVIVING negation names is dropped outright,
    // before anything is globbed. NOT redundant with excluding the expanded directories, which is
    // how it was once mistaken for an optimization and removed: `!packages/?` names the pattern
    // STRING `packages/*` — the `?` matches its literal `*` — without naming any directory that
    // glob would produce. npm returns nothing for that declaration; testing only directories
    // returns everything.
    //
    // pnpm has no equivalent: asked directly, it keeps both packages there. Hence npm's rule only.
    patterns: walked.patterns.filter(
      (pattern) => !walked.negations.some((negation) => cancels(pattern, negation)),
    ),
  };
};

/** Whether a surviving negation names this directory. Decided from the plans alone, so it can be
 * applied before a candidate's manifest is ever opened — an excluded directory must not be able to
 * contribute a diagnostic about a package nobody asked for. */
/** npm's `getGlobPattern`: every pattern gets a trailing separator before it reaches the glob, so
 * that it can only match directories. Applied here too, and it is what makes this step's answer
 * differ from the cancellation step's — `!packages/cli/` rules out `packages/cli` here, while a
 * later `packages/cli` does NOT cancel it there. */
const asDirectoryPattern = (pattern: string): string =>
  pattern.endsWith('/') ? pattern : `${pattern}/`;

const excludedBy = (negations: readonly string[], dir: string): boolean =>
  negations.some((negation) =>
    matchesPattern(asDirectoryPattern(dir), asDirectoryPattern(negatedBody(negation))),
  );

const collect = (results: readonly ExpandResult[]): ExpandResult => {
  const dirs = new Set<string>();
  const diagnostics: WorkspaceDiagnostic[] = [];
  for (const result of results) {
    result.dirs.forEach((dir) => dirs.add(dir));
    diagnostics.push(...result.diagnostics);
  }
  return { diagnostics, dirs: [...dirs] };
};

/** One declaration's patterns, under its own resolver's rules.
 *
 * Only the INCLUSIVE patterns face a shape restriction. They have to be walked, and this scanner
 * expands one level; a negation is only ever matched, and the matcher handles every shape — so
 * `!packages/{a,b}` excludes what it names even though `packages/{a,b}` could not be expanded. */
const expandSelection = async (repoDir: string, selection: Selection): Promise<ExpandResult> => {
  const { negations, patterns } = selection;
  const excluded = { has: (dir: string): boolean => excludedBy(negations, dir) };
  const chosen = collect(
    await Promise.all(
      patterns.map((pattern) =>
        // `body` is what gets classified and matched; `declared` is what a diagnostic quotes, so
        // someone reading it sees what the repository actually wrote.
        expandGlobPattern(repoDir, { body: negatedBody(pattern), declared: pattern }, excluded),
      ),
    ),
  );
  return { diagnostics: chosen.diagnostics, dirs: chosen.dirs };
};

/** Both declarations, each under its own rules, unioned — which is how the scanner has always
 * treated them: neither file takes precedence, they simply add up. What changed is that each one's
 * negations now apply to its own patterns rather than to the merged list. */
const expandPatterns = async (
  repoDir: string,
  declared: { npm: readonly string[]; pnpm: readonly string[] },
): Promise<ExpandResult> => {
  const fromNpm = selectPatterns(declared.npm);
  const fromPnpm = selectPnpmPatterns(declared.pnpm);
  const expanded = await Promise.all([
    expandSelection(repoDir, fromNpm),
    expandSelection(repoDir, fromPnpm),
  ]);
  return collect(expanded);
};

const detectWorkspacePackagesDetailed = async (repoDir: string): Promise<WorkspaceScan> => {
  const declared = await readDeclarations(repoDir);
  if (declared.npm.length === 0 && declared.pnpm.length === 0) {
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

  const expansion = await expandPatterns(repoDir, declared);
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
