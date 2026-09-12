import { CURRENT_DIR_SEGMENT, normalizeSeparators } from './workspaces-shapes.ts';
import { MISSING_DIR_CODES, probeCandidateDir, tryReaddir } from './workspaces-probe.ts';
import { join, posix } from 'node:path';
import type { Dirent } from 'node:fs';
import type { ExcludedDirs } from './workspaces-expand.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { ExpandResult } from './workspaces-probe.ts';
import { Minimatch } from 'minimatch';
import type { WorkspaceDiagnostic } from './workspaces-patterns.ts';
import { resolveInside } from './fs-containment.ts';

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

const MANIFEST_FILE = 'package.json';
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
  /** Whether anything BELOW this path could still match — minimatch's partial mode, which is what
   * makes pruning the matcher's decision rather than a rule of thumb. */
  couldHold: (path: string) => boolean;
  diagnostics: WorkspaceDiagnostic[];
  dirs: string[];
  pattern: string;
  repoDir: string;
  /** Whether the pattern selects the package AT this path. */
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
const descendable = async (
  walk: Walk,
  entry: Dirent,
  at: { excluded: ExcludedDirs; relPath: string },
): Promise<boolean> => {
  if (!walk.couldHold(at.relPath) || NEVER_WALKED.has(entry.name)) {
    return false;
  }
  if (entry.isSymbolicLink()) {
    // An excluded link is not a missed candidate: the repository said it does not want what is
    // behind it, so not looking costs nothing. Reporting it anyway would mark the scan unreliable
    // — which turns the unregistered-package pass off for the whole ref — over a directory
    // nobody asked about.
    if (!at.excluded.has(at.relPath)) {
      await reportLinkedDir(walk, at.relPath);
    }
    return false;
  }
  return entry.isDirectory();
};

/** A symlink is reported only when it points at a DIRECTORY, which is the only shape that could
 * have held a package the walk then missed. A link to a file is not a missed candidate — a
 * repository with a symlinked `README.md` under `packages/` would otherwise have an unreliable
 * scan forever, and an unreliable scan turns the whole unregistered-package pass off. A broken
 * link points at nothing and is silent for the same reason. */
const reportLinkedDir = async (walk: Walk, relPath: string): Promise<void> => {
  const target = await resolveInside(walk.repoDir, join(walk.repoDir, relPath));
  if (target.kind !== 'inside') {
    // Outside the checkout, or pointing at nothing. Neither is a package this walk lost: an
    // outside path is one `resolve` would refuse anyway, and a broken link holds nothing.
    return;
  }
  // `readdir` is the directory test: it is the operation that would have been performed here, so
  // it answers exactly the question — could this link have been walked?
  const listed = await tryReaddir(target.real);
  if (!('code' in listed)) {
    walk.diagnostics.push({ kind: 'candidate_not_inspected', path: relPath });
  }
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
  // This directory first, then its children. A trailing `**` selects its own base, so a walk that
  // only ever inspected children dropped exactly the package `packages/core/**` names.
  await inspect(walk, at.relPath, excluded);
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
    // eslint-disable-next-line no-await-in-loop -- sequential by design; see the doc comment
    if (await descendable(walk, entry, { excluded, relPath })) {
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
  const located = await resolveInside(repoDir, join(repoDir, plan.baseDir));
  if (located.kind === 'missing') {
    // A declared tree the repository does not have is ordinary — `smoke/**/*` in a clone with no
    // `smoke/` — and is the one absence that says nothing about the scan.
    return { diagnostics: [], dirs: [] };
  }
  if (located.kind !== 'inside') {
    // The same guard the single-level expander applies, and for a reason recursion makes sharper:
    // `readdir` FOLLOWS a symlinked base, so without this a `packages` link pointing out of the
    // checkout would be walked in full. The probe at the end refuses each manifest it finds out
    // there, which turns an escape into a list of `manifest_unreadable` lines about paths that
    // are not in the repository — and into silence when the target holds no manifests at all.
    return { diagnostics: [{ kind: 'workspace_dir_unreadable', path: plan.baseDir }], dirs: [] };
  }
  // Matched as the MANIFEST path, which is what both resolvers actually glob: npm appends
  // `/package.json` to every declared pattern, and pnpm appends `/package.{json,yaml,json5}`.
  // The difference is not cosmetic. `packages/core/**` selects `packages/core` itself — `**`
  // matches zero segments before the manifest — while the same pattern matched against the
  // DIRECTORY path does not, so a walk that asked the directory question silently dropped the
  // package the pattern most obviously names. Checked against `@npmcli/map-workspaces` itself
  // over six pattern shapes: matching manifest paths agrees with npm on all of them, matching
  // directory paths on four.
  const matcher = new Minimatch(`${normalizeSeparators(plan.pattern)}/${MANIFEST_FILE}`);
  const manifestIn = (path: string): string => posix.join(path, MANIFEST_FILE);
  const walk: Walk = {
    budget: context.budget,
    couldHold: (path) => matcher.match(manifestIn(path), true),
    diagnostics: [],
    dirs: [],
    pattern: plan.pattern,
    repoDir,
    selects: (path) => matcher.match(manifestIn(path)),
  };
  await walkDir(walk, { depth: 1, relPath: plan.baseDir }, context.excluded);
  return { diagnostics: walk.diagnostics, dirs: walk.dirs };
};

export { expandRecursive, newScanBudget };
export type { ScanBudget };
