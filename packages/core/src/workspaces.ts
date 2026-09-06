// IO orchestration for workspace package detection: expansion order, root handling, and result
// shaping. Turning one pattern into directories lives in `workspaces-expand.ts`; which shapes
// exist at all, in `workspaces-shapes.ts`.
import type {
  WorkspaceDiagnostic,
  WorkspacePackage,
  WorkspaceScan,
} from './workspaces-patterns.ts';
import {
  classifyWorkspacePattern,
  isNegatedPattern,
  normalizeSeparators,
  planMatchesPath,
} from './workspaces-shapes.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { deduplicateAndSort, sortDiagnostics } from './workspaces-patterns.ts';
import { excludedDirs, expandGlobSingleLevel, expandLiteralDir } from './workspaces-expand.ts';
import { partitionProbes, probePackageDir } from './workspaces-probe.ts';
import { probeRootPackage, withoutClaimedRoot } from './workspaces-root.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { ExpandResult } from './workspaces-probe.ts';
import { readDeclarations } from './workspaces-declarations.ts';

/** Whether a pattern AFTER `index` names `dir` again. Glob lists let a later inclusion win over an
 * earlier exclusion, and npm honours that; deciding it from the plan rather than the filesystem
 * keeps exclusions settled before anything is probed. */
const reincludedAfter = (declared: readonly string[], dir: string, index: number): boolean =>
  declared.some(
    (pattern, at) =>
      at > index &&
      !isNegatedPattern(pattern) &&
      planMatchesPath(classifyWorkspacePattern(pattern), dir),
  );

// Expand one glob pattern. Which form the pattern takes is decided purely in
// `classifyWorkspacePattern`; only the plan's filesystem side runs here. An ignored pattern is
// reported: a package could be hiding behind it, so the scan is not complete.
const expandGlobPattern = (
  repoDir: string,
  spec: { body: string; declared: string },
  excluded: ReadonlySet<string>,
): Promise<ExpandResult> => {
  const plan = classifyWorkspacePattern(spec.body);
  if (plan.kind === 'expand-children') {
    return expandGlobSingleLevel(repoDir, plan, excluded);
  }

  if (plan.kind === 'probe-dir') {
    return excluded.has(normalizeSeparators(plan.dir))
      ? Promise.resolve({ diagnostics: [], dirs: [] })
      : expandLiteralDir(repoDir, plan.dir);
  }

  // Reported as the repository wrote it, `!` included: that is what someone has to go and read.
  return Promise.resolve({
    diagnostics: [{ kind: 'unsupported_pattern', pattern: spec.declared }],
    dirs: [],
  });
};

const collect = (results: readonly ExpandResult[]): ExpandResult => {
  const dirs = new Set<string>();
  const diagnostics: WorkspaceDiagnostic[] = [];
  for (const result of results) {
    result.dirs.forEach((dir) => dirs.add(dir));
    diagnostics.push(...result.diagnostics);
  }
  return { diagnostics, dirs: [...dirs] };
};

/** Expand every pattern: the inclusive ones select directories, the negated ones deselect them.
 *
 * Both sides go through the same expander, so `!packages/fixtures` and `!packages/*` are as
 * supported as their inclusive twins, and a negation nobody can expand reports
 * `unsupported_pattern` exactly as an inclusive one would — the honest outcome, since a negation
 * left unapplied leaves the scan holding directories the repository excluded.
 *
 * Order IS modelled: npm's resolver honours it, verified against `@npmcli/map-workspaces` —
 * `["packages/*", "!packages/cli", "packages/cli"]` yields BOTH packages, the later inclusion
 * winning over the earlier exclusion. Subtracting every negation at the end would drop `cli`
 * permanently. So a negation removes a directory only when no later inclusive pattern names it
 * again, decided from the classified plan rather than the filesystem so exclusions still settle
 * before anything is probed. */
const expandPatterns = async (repoDir: string, patterns: Set<string>): Promise<ExpandResult> => {
  const declared = [...patterns];
  // Exclusions are resolved FIRST, so the inclusive pass never probes a directory the repository
  // ruled out. Probing it anyway is not merely wasted work: an unreadable manifest under an
  // excluded path would report a diagnostic, and one diagnostic marks the entire scan unreliable.
  const negations = declared.flatMap((pattern, index) =>
    isNegatedPattern(pattern) ? [{ index, pattern }] : [],
  );
  const expanded = await Promise.all(
    negations.map(async (item) => ({
      index: item.index,
      result: await excludedDirs(repoDir, item.pattern),
    })),
  );
  const deselected = collect(expanded.map((item) => item.result));
  const out = new Set(
    expanded.flatMap((item) =>
      item.result.dirs.filter((dir) => !reincludedAfter(declared, dir, item.index)),
    ),
  );
  const chosen = collect(
    await Promise.all(
      declared
        .filter((pattern) => !isNegatedPattern(pattern))
        .map((pattern) => expandGlobPattern(repoDir, { body: pattern, declared: pattern }, out)),
    ),
  );
  return {
    diagnostics: [...chosen.diagnostics, ...deselected.diagnostics],
    dirs: chosen.dirs,
  };
};

const detectWorkspacePackagesDetailed = async (repoDir: string): Promise<WorkspaceScan> => {
  const declared = await readDeclarations(repoDir);
  if (declared.patterns.size === 0) {
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
