import {
  CURRENT_DIR_SEGMENT,
  classifyWorkspacePattern,
  matchesPattern,
  normalizeSeparators,
} from './workspaces-shapes.ts';

import {
  MISSING_DIR_CODES,
  probeCandidateDir,
  probeChildren,
  tryReaddir,
} from './workspaces-probe.ts';
import { join, posix } from 'node:path';
import type { Dirent } from 'node:fs';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { ExpandResult } from './workspaces-probe.ts';
import type { ScanBudget } from './workspaces-recursive.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { WildcardPlan } from './workspaces-shapes.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { expandRecursive } from './workspaces-recursive.ts';
import { resolveInside } from './fs-containment.ts';

// Turning one classified pattern into directories: reading a base dir, selecting its children, and
// probing a literal path. Split from `workspaces.ts` for the 300-line cap; which shapes exist at
// all is decided in `workspaces-shapes.ts`.

/** Which directories a surviving negation rules out. A predicate rather than a set, because the
 * answer comes from comparing plans and needs no listing — so an excluded directory's manifest is
 * never opened, and cannot contribute a diagnostic about a package nobody asked for. */
type ExcludedDirs = { coversSubtree: (dir: string) => boolean; has: (dir: string) => boolean };

/** The repo-relative path a child of the base directory stands for: the base, the child's name,
 * and the pattern's literal suffix.
 *
 * Selection and exclusion both ask this, so they cannot disagree about which path is being decided
 * on. `probeChildren` builds the same string again for its diagnostics and its results, and
 * `probeAll` joins the filesystem path from the same three parts — three assemblies of one identity
 * is what makes forgetting the suffix in one of them possible, and the tests pin each separately
 * for that reason. */
const candidatePath = (plan: WildcardPlan, name: string): string =>
  posix.join(plan.baseDir === CURRENT_DIR_SEGMENT ? '' : plan.baseDir, name, plan.suffix);

/** Whether one child of the base directory is selected by the pattern that opened it.
 *
 * Matched as the repo-relative PATH rather than as a bare name, because that is what the pattern
 * is written against — `examples/vue/2*` keeps `2.6-basic` and drops `nuxt3`, and the matcher
 * decides that, not this file. With a suffix the path carries it too, which is what lets
 * `crates/*` + `js` be matched against `crates/*` + `/js` as one string. */
const selected = (entry: Dirent, plan: WildcardPlan): boolean =>
  matchesPattern(candidatePath(plan, entry.name), plan.pattern);

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
  plan: WildcardPlan,
  excluded: ExcludedDirs,
): Promise<ExpandResult> => {
  const { baseDir } = plan;
  const read = await readBaseDir(repoDir, baseDir);
  if ('result' in read) {
    return read.result;
  }
  // The exclusion is asked about the SAME path selection produced — with the suffix. Asking about
  // the parent would let an excluded `crates/foo/js` be probed anyway, and an unreadable manifest
  // under it would then make the whole scan unreliable for a directory the repository excluded.
  const takes = (entry: Dirent): boolean =>
    selected(entry, plan) && !excluded.has(candidatePath(plan, entry.name));
  const listed = { entries: read.entries };
  return probeChildren({
    baseDir,
    dirs: listed.entries.filter((entry) => entry.isDirectory() && takes(entry)),
    fullPath: join(repoDir, baseDir),
    repoDir,
    suffix: plan.suffix,
    // `readdir` uses lstat semantics, so a symlinked directory is not `isDirectory()` and never
    // becomes a candidate — it is invisible to detection, inside or outside the repo alike. That
    // was harmless while the scan only fed `add`'s best-effort proposal; now that callers infer
    // "gone" and "uniquely relocated" from it, an uninspected candidate has to be admitted.
    symlinks: listed.entries.filter((entry) => entry.isSymbolicLink() && takes(entry)),
  });
};

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

// Expand one pattern. Which form it takes is decided purely in `classifyWorkspacePattern`; only
// the plan's filesystem side runs here. A pattern nobody can expand is reported: a package could
// be hiding behind it, so the scan is not complete.
const expandGlobPattern = (
  repoDir: string,
  spec: { body: string; declared: string },
  context: { budget: ScanBudget; excluded: ExcludedDirs },
): Promise<ExpandResult> => {
  const { excluded } = context;
  const plan = classifyWorkspacePattern(spec.body);
  if (plan.kind === 'expand-children') {
    return expandGlobSingleLevel(repoDir, plan, excluded);
  }

  if (plan.kind === 'expand-recursive') {
    return expandRecursive(repoDir, plan, context);
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

export { expandGlobPattern, expandGlobSingleLevel, expandLiteralDir, readBaseDir, selected };
export type { ExcludedDirs };
