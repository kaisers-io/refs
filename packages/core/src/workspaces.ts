// IO orchestration for workspace package detection: readdir walks, package.json probes, and
// realpath containment guards. The pure decision logic (pattern classification, containment
// decisions, candidate selection, result shaping) lives in `workspaces-patterns.ts`.
import {
  CURRENT_DIR_SEGMENT,
  classifyWorkspacePattern,
  isNegatedPattern,
  matchesSegment,
  negatedBody,
} from './workspaces-shapes.ts';
import {
  MISSING_DIR_CODES,
  partitionProbes,
  probeCandidateDir,
  probeChildren,
  probePackageDir,
  tryReaddir,
} from './workspaces-probe.ts';
import type {
  WorkspaceDiagnostic,
  WorkspacePackage,
  WorkspaceScan,
} from './workspaces-patterns.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { deduplicateAndSort, sortDiagnostics } from './workspaces-patterns.ts';
import { join, posix } from 'node:path';
import { probeRootPackage, withoutClaimedRoot } from './workspaces-root.ts';
import type { Dirent } from 'node:fs';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { ExpandResult } from './workspaces-probe.ts';
import { readDeclarations } from './workspaces-declarations.ts';
import { resolveInside } from './fs-containment.ts';

/** Whether one directory entry is selected by an `expand-children` plan. A plan without `match` is
 * a plain `<dir>/*` and takes every child; one with it came from a wildcard inside the last
 * segment and takes only the names that fit. */
const selected = (entry: Dirent, match?: { prefix: string; suffix: string }): boolean =>
  match === undefined || matchesSegment(entry.name, match);

// One-level glob expansion. Reports the two ways it can come up empty for a reason — a base
// directory that resolves outside the repo, and one that exists but cannot be read — instead of
// letting both look like "no packages here". A base directory the pattern merely names but that
// does not exist is normal (`packages/*` before `packages/` is created) and reports nothing.
/** Locate and read the base directory, or say why it yielded nothing. Split out so the caller
 * stays about SELECTION: the three ways a base dir comes up empty are all decided here. */
const readBaseDir = async (
  repoDir: string,
  baseDir: string,
): Promise<{ entries: Dirent[] } | { result: ExpandResult }> => {
  const fullPath = join(repoDir, baseDir);
  // `resolveInside` answers with missing/outside/unreadable rather than a bare boolean. A
  // boolean cannot tell "this directory does not exist yet" from "I refused to look", and
  // reporting the first as a failure would mark `packages/*` unreliable in every repo that has
  // not created `packages/` yet. Only `outside` and `unreadable` are real problems here.
  const located = await resolveInside(repoDir, fullPath);
  if (located.kind === 'missing') {
    return { result: { diagnostics: [], dirs: [] } };
  }
  if (located.kind !== 'inside') {
    return {
      result: { diagnostics: [{ kind: 'workspace_dir_unreadable', path: baseDir }], dirs: [] },
    };
  }
  // The bare `*` pattern resolves to the repo root itself, which `isInside` accepts; every other
  // base dir is genuinely below it. No separate allowSelf handling is needed.

  const listed = await tryReaddir(fullPath);
  if ('code' in listed) {
    // The rejection already carries `code` — no extra `stat` needed, and an extra stat would
    // only add a race. A base directory that is not there is normal; anything else is not.
    return {
      result: MISSING_DIR_CODES.has(listed.code)
        ? { diagnostics: [], dirs: [] }
        : { diagnostics: [{ kind: 'workspace_dir_unreadable', path: baseDir }], dirs: [] },
    };
  }
  return { entries: listed.entries };
};

const expandGlobSingleLevel = async (
  repoDir: string,
  plan: { baseDir: string; match?: { prefix: string; suffix: string } },
  excluded: ReadonlySet<string>,
): Promise<ExpandResult> => {
  const { baseDir } = plan;
  const read = await readBaseDir(repoDir, baseDir);
  if ('result' in read) {
    return read.result;
  }
  const base = baseDir === CURRENT_DIR_SEGMENT ? '' : baseDir;
  const takes = (entry: Dirent): boolean =>
    selected(entry, plan.match) && !excluded.has(posix.join(base, entry.name));
  const listed = { entries: read.entries };
  return probeChildren({
    baseDir,
    dirs: listed.entries.filter((entry) => entry.isDirectory() && takes(entry)),
    fullPath: join(repoDir, baseDir),
    repoDir,
    // `readdir` uses lstat semantics, so a symlinked directory is not `isDirectory()` and never
    // becomes a candidate — it is invisible to detection, inside or outside the repo alike. That
    // was harmless while the scan only fed `add`'s best-effort proposal; now that callers infer
    // "gone" and "uniquely relocated" from it, an uninspected candidate has to be admitted.
    symlinks: listed.entries.filter((entry) => entry.isSymbolicLink() && takes(entry)),
  });
};

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

/** A package path is an identifier, not a filesystem string: it is compared against configured
 * entries, against the paths git reports, and printed into commands `zPackagePath` must accept —
 * and `zPackagePath` rejects both a trailing slash and an empty segment. A literal declaration
 * keeps whatever the repository wrote, and `packages//new/` is as legal to npm and pnpm as
 * `packages/new`, so separators are collapsed and trimmed where the pattern becomes a path.
 *
 * Written out rather than delegated to `posix.normalize`, which also resolves `.` and `..`
 * segments — a traversal-shaped pattern is rejected upstream as unsafe, and quietly resolving one
 * here would be a second, weaker answer to a question already decided.
 *
 * The glob branch needs no equivalent: it builds its paths with `posix.join`, which normalizes. */
const normalizeSeparators = (dir: string): string =>
  dir.replaceAll(/\/+/gu, '/').replace(/\/$/u, '');

// A wildcard-free pattern names one directory. Same three-way probe the glob branch uses: the
// old boolean pair collapsed "no package here" (normal) with "refused to look" (a hole in the
// scan), so a literal pattern naming an unreadable directory — or one symlinked out of the repo
// — used to leave the scan looking complete.
const expandLiteralDir = async (repoDir: string, dir: string): Promise<ExpandResult> => {
  const probe = await probeCandidateDir(repoDir, join(repoDir, dir));
  if (probe === 'manifest') {
    return { diagnostics: [], dirs: [normalizeSeparators(dir)] };
  }
  if (probe === 'rejected') {
    return { diagnostics: [{ kind: 'manifest_unreadable', path: dir }], dirs: [] };
  }
  return { diagnostics: [], dirs: [] };
};

/** The directory paths one negation names — WITHOUT probing their manifests.
 *
 * An exclusion is a statement about paths, not about packages: whether the directory holds a
 * readable manifest has no bearing on whether the repository wants it. Probing anyway produced a
 * `manifest_unreadable` diagnostic for a directory nobody asked about, which marked the whole scan
 * unreliable and silenced every finding — over a package the repository had told us to ignore.
 *
 * A base directory that cannot be listed IS reported: the exclusion then cannot be applied, and
 * the scan may hold directories the repository excluded. */
const excludedDirs = async (repoDir: string, pattern: string): Promise<ExpandResult> => {
  const plan = classifyWorkspacePattern(negatedBody(pattern));
  if (plan.kind === 'probe-dir') {
    return { diagnostics: [], dirs: [normalizeSeparators(plan.dir)] };
  }
  if (plan.kind !== 'expand-children') {
    return { diagnostics: [{ kind: 'unsupported_pattern', pattern }], dirs: [] };
  }
  const read = await readBaseDir(repoDir, plan.baseDir);
  if ('result' in read) {
    return { diagnostics: read.result.diagnostics, dirs: [] };
  }
  const base = plan.baseDir === CURRENT_DIR_SEGMENT ? '' : plan.baseDir;
  return {
    diagnostics: [],
    dirs: read.entries
      .filter(
        (entry) => (entry.isDirectory() || entry.isSymbolicLink()) && selected(entry, plan.match),
      )
      .map((entry) => posix.join(base, entry.name)),
  };
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
 * Order is not modelled. pnpm and npm both apply negations after inclusions, and neither
 * re-includes a directory a later positive pattern names again; subtracting once at the end is
 * that same rule. */
const expandPatterns = async (repoDir: string, patterns: Set<string>): Promise<ExpandResult> => {
  const declared = [...patterns];
  // Exclusions are resolved FIRST, so the inclusive pass never probes a directory the repository
  // ruled out. Probing it anyway is not merely wasted work: an unreadable manifest under an
  // excluded path would report a diagnostic, and one diagnostic marks the entire scan unreliable.
  const deselected = collect(
    await Promise.all(
      declared
        .filter((pattern) => isNegatedPattern(pattern))
        .map((pattern) => excludedDirs(repoDir, pattern)),
    ),
  );
  const out = new Set(deselected.dirs);
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
