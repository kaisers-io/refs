import { MISSING_DIR_CODES, probeCandidateDir, tryReaddir } from './workspaces-probe.ts';
import { depthOf, planFor } from './workspaces-pattern-plan.ts';
import { join, posix } from 'node:path';
import { CURRENT_DIR_SEGMENT } from './workspaces-shapes.ts';
import type { Dirent } from 'node:fs';
import type { ExcludedDirs } from './workspaces-expand.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { ExpandResult } from './workspaces-probe.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { PatternPlan } from './workspaces-pattern-plan.ts';
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

// `readdir` on something that is not a directory. Both spellings occur: Linux and macOS answer
// ENOTDIR, Windows answers ENOENT for the same shape.
const NOT_A_DIRECTORY_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);
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

type Walk = PatternPlan & {
  budget: ScanBudget;
  /** Whether this pattern names a hidden segment outright. A `<prefix>` + wildcard exclusion does
   * NOT cover a hidden descendant — minimatch's wildcards skip dot-names unless the pattern says
   * otherwise — so a pattern that reaches into one must keep walking a subtree such an exclusion
   * appears to cover. Pruning there would drop a package nothing excluded. */
  selectsHidden: boolean;
  /** How deep a match can sit, when the pattern bounds it at all. A wildcard-only pattern has a
   * fixed segment count, so a directory at that depth cannot hold a selected DESCENDANT — and
   * listing it would spend entries on a subtree that could never contribute. `**` matches any
   * number of segments, so it bounds nothing. */
  maxDepth: number | undefined;
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
  if (!walk.selectsHidden && at.excluded.coversSubtree(at.relPath)) {
    // Nothing under it can be selected, so walking it can only spend budget that the packages
    // this scan IS looking for would otherwise get. A repository excluding a large generated
    // tree would otherwise lose real packages to it.
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
  if (target.kind === 'outside' || target.kind === 'missing') {
    // Neither is a package this walk lost: an outside path is one `resolve` would refuse anyway,
    // and a broken link holds nothing.
    return;
  }
  if (target.kind === 'unreadable') {
    // A failure to look is never evidence. Staying quiet here would let an unreadable link
    // establish that the scan was complete, and callers draw "this package is gone" from that.
    walk.diagnostics.push({ kind: 'candidate_not_inspected', path: relPath });
    return;
  }
  // `readdir` is the directory test: it is the operation that would have been performed here, so
  // it answers exactly the question — could this link have been walked? A refusal (EACCES, EIO)
  // is not the same answer as "not a directory", and only the second one is silent.
  const listed = await tryReaddir(target.real);
  if (!('code' in listed) || !NOT_A_DIRECTORY_CODES.has(listed.code)) {
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
  // `< 0`, not `<= 0`: a listing that exactly fits the remaining budget was paid for in full, and
  // nothing below it was left unwalked. Reporting incompleteness there would disable discovery
  // over a walk that finished.
  if (walk.budget.entries < 0) {
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
  // only ever inspected children dropped exactly the package that pattern names.
  await inspect(walk, at.relPath, excluded);
  if (walk.maxDepth !== undefined && depthOf(at.relPath) >= walk.maxDepth) {
    // Every path this pattern can select has been inspected. Listing this directory anyway spends
    // entries — and a package holding 200 000 files would then report the scan incomplete, having
    // in fact looked everywhere the pattern reaches.
    return;
  }
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

/** Whether the base can be walked at all: absent is ordinary, outside the checkout is not.
 *
 * A declared tree the repository does not have — `smoke/**` in a clone with no `smoke/` — is the
 * one absence that says nothing about the scan. An escape is the opposite: `readdir` FOLLOWS a
 * symlinked base, so without this guard a `packages` link pointing out of the checkout is walked
 * in full, and the manifest probe's own refusals turn that into a list of complaints about paths
 * that are not in the repository — or into silence, when the target holds no manifests at all.
 * The single-level expander has applied the same guard since it was written. */
const baseFault = async (repoDir: string, baseDir: string): Promise<ExpandResult | undefined> => {
  const located = await resolveInside(repoDir, join(repoDir, baseDir));
  if (located.kind === 'inside') {
    return undefined;
  }
  return located.kind === 'missing'
    ? { diagnostics: [], dirs: [] }
    : { diagnostics: [{ kind: 'workspace_dir_unreadable', path: baseDir }], dirs: [] };
};

/** Two matchers, for two different questions.
 *
 * SELECTION asks about the MANIFEST path, which is what both resolvers actually glob: npm appends
 * `/package.json` to every declared pattern. That is not cosmetic — a trailing `**` matches zero
 * segments before the manifest, so `packages/core/**` selects `packages/core` itself, which the
 * same pattern matched against the directory path does not. Checked against
 * `@npmcli/map-workspaces` itself over six pattern shapes: manifest paths agree with npm on all
 * six, directory paths on four.
 *
 * PRUNING asks about the directory prefix. Appending the manifest name there asks whether an
 * ancestor's own manifest path could match a pattern that ends in another wildcard segment — it
 * cannot, so the whole valid subtree below that ancestor is skipped while the scan still reports
 * itself complete. (No glob is written out here: a wildcard followed by a slash closes a doc
 * block early.) */
// Expands one recursive pattern from the deepest directory it names outright.
const expandRecursive = async (
  repoDir: string,
  plan: { baseDir: string; pattern: string },
  context: { budget: ScanBudget; excluded: ExcludedDirs },
): Promise<ExpandResult> => {
  const fault = await baseFault(repoDir, plan.baseDir);
  if (fault !== undefined) {
    return fault;
  }
  const walk: Walk = {
    ...planFor(plan.pattern),
    budget: context.budget,
    diagnostics: [],
    dirs: [],
    pattern: plan.pattern,
    repoDir,
  };
  await walkDir(walk, { depth: 1, relPath: plan.baseDir }, context.excluded);
  return { diagnostics: walk.diagnostics, dirs: walk.dirs };
};

export { expandRecursive, newScanBudget };
export type { ScanBudget };
