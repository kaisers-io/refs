import type { Dirent } from 'node:fs';
import type { Walk } from './workspaces-recursive.ts';
import { join } from 'node:path';
import { resolveInside } from './fs-containment.ts';
import { tryReaddir } from './workspaces-probe.ts';

// What a symlinked directory means to a walk that cannot follow it.
//
// `readdir` uses lstat semantics, so a symlink is never `isDirectory()` and is never walked. The
// only question is whether NOT walking it cost anything — and the answer decides whether the whole
// scan is reported as complete, because one uninspected candidate turns the unregistered-package
// pass off for the entire ref.

const MANIFEST_FILE = 'package.json';
const MAX_LINK_DEPTH = 32;

// `readdir` on something that is not a directory. Both spellings occur: Linux and macOS answer
// ENOTDIR, Windows answers ENOENT for the same shape.
const NOT_A_DIRECTORY_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

// Never walked, under any pattern, so never searched for a manifest either.
const NEVER_WALKED: ReadonlySet<string> = new Set(['.git', 'node_modules']);

/** A manifest here, by the name and by not being a directory.
 *
 * `isFile()` is false for a SYMLINKED `package.json`, and the manifest probe accepts that shape,
 * so testing for a regular file would answer "no manifest" about a package that resolves
 * perfectly well.
 *
 * Compared case-insensitively, because the probe this stands in for opens `<dir>/package.json` by
 * name: on a case-insensitive filesystem a directory holding `Package.json` has a manifest the
 * probe reads happily, while an exact comparison here would report there is none. On a
 * case-sensitive one this over-reports — a link is left marked uninspected — which is the
 * direction to err in. */
const manifestIn = (entries: readonly Dirent[]): boolean =>
  entries.some((entry) => entry.name.toLowerCase() === MANIFEST_FILE && !entry.isDirectory());

/** A link inside the subtree being searched. Nothing below it can be ruled out without following
 * it, and following links from inside a link is how a search stops being cheap and starts needing
 * cycle bookkeeping of its own. Conservative answer: something might be down there. */
const linkIn = (entries: readonly Dirent[]): boolean =>
  entries.some((entry) => entry.isSymbolicLink() && !NEVER_WALKED.has(entry.name));

/** Whether any manifest exists anywhere below `dir` — the one question that settles what a link
 * the walk cannot follow is worth saying.
 *
 * Answered by LOOKING, not by reasoning about the pattern. An earlier attempt tried to prove that
 * the target's own path selects whatever the link path selects, from the pattern's shape; five
 * counterexamples later (#126) the lesson is that the two paths are different strings and no
 * property of the pattern makes them interchangeable. This asks something the filesystem can
 * answer outright: if there is no manifest under there, no pattern selects a package there, and
 * the link hid nothing from anyone.
 *
 * Spends the walk's own budget, and reports "found one" when it runs out — an unfinished look is
 * not a look. A cycle (a link pointing at its own ancestor) ends the same way rather than
 * spinning, since every directory it visits charges the same counters. */
/** This directory's own verdict: `undefined` when the subdirectories still have to be asked. */
const settledHere = async (
  walk: Walk,
  dir: string,
): Promise<{ answer: boolean } | { entries: Dirent[] }> => {
  const listed = await tryReaddir(dir);
  if ('code' in listed) {
    // Not a directory is an answer: a link to a file holds no package. Anything else is a refusal
    // to look, which never becomes evidence.
    return { answer: NOT_A_DIRECTORY_CODES.has(listed.code) };
  }
  walk.budget.entries -= listed.entries.length;
  if (walk.budget.entries < 0 || manifestIn(listed.entries) || linkIn(listed.entries)) {
    return { answer: false };
  }
  return { entries: listed.entries };
};

const holdsNoManifest = async (walk: Walk, dir: string, depth: number): Promise<boolean> => {
  if (walk.budget.dirs <= 0 || depth > MAX_LINK_DEPTH) {
    return false;
  }
  walk.budget.dirs -= 1;
  const here = await settledHere(walk, dir);
  return 'answer' in here ? here.answer : allHoldNone(walk, { dir, entries: here.entries }, depth);
};

/** Every subdirectory in turn, sequentially: the budget is a shared counter, and a fan-out would
 * both overspend it and open one handle per directory. */
const allHoldNone = async (
  walk: Walk,
  at: { dir: string; entries: readonly Dirent[] },
  depth: number,
): Promise<boolean> => {
  const dirs = at.entries.filter((entry) => entry.isDirectory() && !NEVER_WALKED.has(entry.name));
  for (const entry of dirs) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design; see the doc comment
    if (!(await holdsNoManifest(walk, join(at.dir, entry.name), depth + 1))) {
      return false;
    }
  }
  return true;
};

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
  if (!(await holdsNoManifest(walk, target.real, 1))) {
    walk.diagnostics.push({ kind: 'candidate_not_inspected', path: relPath });
  }
};

export { reportLinkedDir };
