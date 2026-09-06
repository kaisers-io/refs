import {
  CURRENT_DIR_SEGMENT,
  classifyWorkspacePattern,
  matchesSegment,
  negatedBody,
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
import { resolveInside } from './fs-containment.ts';

// Turning one classified pattern into directories: reading a base dir, selecting its children, and
// probing a literal path. Split from `workspaces.ts` for the 300-line cap; which shapes exist at
// all is decided in `workspaces-shapes.ts`.

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

export { excludedDirs, expandGlobSingleLevel, expandLiteralDir, readBaseDir, selected };
