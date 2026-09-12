import { CURRENT_DIR_SEGMENT, normalizeSeparators } from './workspaces-shapes.ts';
import { MISSING_DIR_CODES, probeCandidateDir, tryReaddir } from './workspaces-probe.ts';
import { join, posix } from 'node:path';
import type { Dirent } from 'node:fs';
import type { ExcludedDirs } from './workspaces-expand.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { ExpandResult } from './workspaces-probe.ts';
import { Minimatch } from 'minimatch';
import type { WorkspaceDiagnostic } from './workspaces-patterns.ts';

// Walking a pattern that can match at more than one depth — the `packages/**` family, the most
// common pnpm spelling, and the one shape `wildcardSegmentPlan` cannot serve because there is no single level
// to expand.
//
// Two things make this affordable. Pruning is decided by the MATCHER, not by a rule of thumb:
// minimatch answers "could anything below this directory still match?" (`match(path, true)`), so a
// subtree no pattern can reach is never entered, and an explicitly declared hidden directory is
// entered even though a wildcard would not select it. And the whole walk runs under one budget
// shared by every pattern of the scan, because patterns overlap — astro declares three `**`
// patterns over trees that intersect, and per-pattern budgets would charge the same directories
// three times over.

/** The counters one scan spends. Mutable and shared on purpose: a per-pattern budget multiplies
 * with the number of declarations, which is the opposite of a bound. */
type ScanBudget = { dirs: number; entries: number };

const MAX_DEPTH = 32;
const MAX_DIRS = 20_000;
const MAX_ENTRIES = 200_000;

const newScanBudget = (): ScanBudget => ({ dirs: MAX_DIRS, entries: MAX_ENTRIES });

// Never walked, under any pattern. A recursive pattern under `packages/` matches
// `packages/a/node_modules/b` as a string, and neither npm nor pnpm treats an installed
// dependency as a workspace member — so walking it would not be fidelity, it would be reporting a
// repository's dependencies as its own packages. `.git` is the same answer for the same reason.
// (Line comments, not a doc block: a `**` glob written out closes one early.)
const NEVER_WALKED: ReadonlySet<string> = new Set(['.git', 'node_modules']);

type Walk = {
  budget: ScanBudget;
  /** Whether the pattern selects this exact path. */
  couldHold: (path: string) => boolean;
  diagnostics: WorkspaceDiagnostic[];
  dirs: string[];
  pattern: string;
  repoDir: string;
  /** Whether anything BELOW this path could still match — minimatch's partial mode, which is what
   * makes pruning the matcher's decision rather than a rule of thumb. */
  selects: (path: string) => boolean;
};

const exhausted = (walk: Walk, path: string): void => {
  walk.diagnostics.push({ kind: 'scan_budget_exhausted', path, pattern: walk.pattern });
};

/** One directory's own verdict: does the pattern select it, and if so, is there a package here? */
const inspect = async (walk: Walk, relPath: string, excluded: ExcludedDirs): Promise<void> => {
  if (!walk.selects(relPath) || excluded.has(relPath)) {
    return;
  }
  const probe = await probeCandidateDir(walk.repoDir, join(walk.repoDir, relPath));
  if (probe === 'manifest') {
    walk.dirs.push(relPath);
  }
  if (probe === 'rejected') {
    walk.diagnostics.push({ kind: 'manifest_unreadable', path: relPath });
  }
};

/** Whether this entry is worth descending into, and what to say when it is not inspectable.
 *
 * A symlinked directory is not `isDirectory()` under `readdir`'s lstat semantics, so it can never
 * be walked here — and one that could have held a match makes the scan incomplete rather than
 * simply absent, the same rule `probeChildren` applies one level down. */
const descendable = (walk: Walk, entry: Dirent, relPath: string): boolean => {
  if (!walk.couldHold(relPath)) {
    return false;
  }
  if (entry.isSymbolicLink()) {
    walk.diagnostics.push({ kind: 'candidate_not_inspected', path: relPath });
    return false;
  }
  return entry.isDirectory() && !NEVER_WALKED.has(entry.name);
};

/** This directory's entries, or the reason there are none to walk. Spending the entry budget is
 * part of reading: a directory that was listed has been paid for whether or not anything below it
 * matched. */
const entriesOf = async (walk: Walk, relPath: string): Promise<Dirent[] | undefined> => {
  const listed = await tryReaddir(join(walk.repoDir, relPath));
  if ('code' in listed) {
    // A directory the pattern names but that does not exist is ordinary — astro declares
    // `smoke/**/*` and a fresh clone has no `smoke/` — and reporting it would mark the scan
    // unreliable on every such repository. Anything else IS a place a package might be hiding:
    // the walk only got here because the pattern could still match below it.
    if (!MISSING_DIR_CODES.has(listed.code)) {
      walk.diagnostics.push({ kind: 'workspace_dir_unreadable', path: relPath });
    }
    return undefined;
  }
  walk.budget.entries -= listed.entries.length;
  if (walk.budget.entries <= 0) {
    exhausted(walk, relPath);
    return undefined;
  }
  return listed.entries;
};

const walkDir = async (
  walk: Walk,
  at: { depth: number; relPath: string },
  excluded: ExcludedDirs,
): Promise<void> => {
  if (walk.budget.dirs <= 0) {
    exhausted(walk, at.relPath);
    return;
  }
  walk.budget.dirs -= 1;
  const entries = await entriesOf(walk, at.relPath);
  if (entries !== undefined) {
    await descendAll(walk, { depth: at.depth, entries, relPath: at.relPath }, excluded);
  }
};

const childPath = (relPath: string, name: string): string =>
  posix.join(relPath === CURRENT_DIR_SEGMENT ? '' : relPath, name);

/** Depth-first and strictly sequential. The budget is a shared mutable counter, so a `Promise.all`
 * fan-out over 20 000 candidates would both overspend it and open that many file handles at once
 * — the cost this bound exists to keep. */
const descendAll = async (
  walk: Walk,
  at: { depth: number; entries: readonly Dirent[]; relPath: string },
  excluded: ExcludedDirs,
): Promise<void> => {
  for (const entry of at.entries) {
    const relPath = childPath(at.relPath, entry.name);
    if (descendable(walk, entry, relPath)) {
      // eslint-disable-next-line no-await-in-loop -- sequential by design; see the doc comment
      await inspect(walk, relPath, excluded);
      if (at.depth + 1 > MAX_DEPTH) {
        exhausted(walk, relPath);
      } else {
        // eslint-disable-next-line no-await-in-loop -- sequential by design; see the doc comment
        await walkDir(walk, { depth: at.depth + 1, relPath }, excluded);
      }
    }
  }
};

// Expands one recursive pattern from its wildcard-free base. The base itself is never a candidate
// — a recursive pattern under `packages/` does not select `packages`, and the matcher says so.
const expandRecursive = async (
  repoDir: string,
  plan: { baseDir: string; pattern: string },
  context: { budget: ScanBudget; excluded: ExcludedDirs },
): Promise<ExpandResult> => {
  const matcher = new Minimatch(normalizeSeparators(plan.pattern));
  const walk: Walk = {
    budget: context.budget,
    couldHold: (path) => matcher.match(path, true),
    diagnostics: [],
    dirs: [],
    pattern: plan.pattern,
    repoDir,
    selects: (path) => matcher.match(path),
  };
  await walkDir(walk, { depth: 1, relPath: plan.baseDir }, context.excluded);
  return { diagnostics: walk.diagnostics, dirs: walk.dirs };
};

export { expandRecursive, newScanBudget };
export type { ScanBudget };
