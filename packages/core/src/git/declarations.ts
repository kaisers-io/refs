import { collectPnpmPatterns, parseNpmWorkspaces } from '../workspaces-parse.ts';
import type { Runner } from '../proc/runner.ts';

// Did the repository's workspace DECLARATION change across a range?
//
// `arrivals.ts` establishes which package names existed before a range from two sources: the
// manifests the range changed, read out of history, and the members it did not touch, whose
// current names are also their previous ones because those files are byte-identical at both ends.
// That second half holds only for members the scan can still see. A declaration change breaks it:
// dropping `packages/b` from `workspaces` removes that package from the scan without touching its
// manifest, so the name it carried is remembered by neither source — and a new directory carrying
// the same name would then be announced as an arrival it is not.
//
// The declaration is compared rather than merely checked for a touched file, because a root
// manifest changes constantly (a version bump, a dependency edit) while its `workspaces` field
// almost never does, and suppressing arrivals on every root commit would silence the feature in
// most repositories.

const ROOT_MANIFEST = 'package.json';
const PNPM_WORKSPACE_FILE = 'pnpm-workspace.yaml';
const SUCCESS_EXIT_CODE = 0;

type RangeOpts = {
  dir: string;
  from: string;
  to: string;
};

/** One file's contents at one revision. `undefined` covers both "not there" and "could not be
 * read" — a distinction that does not matter here, because the caller treats every unreadable
 * declaration the same way it treats a changed one. */
const showFile = async (
  runner: Runner,
  opts: { dir: string; path: string; rev: string },
): Promise<string | undefined> => {
  const result = await runner.run('git', ['show', `${opts.rev}:${opts.path}`], { cwd: opts.dir });
  return result.exitCode === SUCCESS_EXIT_CODE ? result.stdout : undefined;
};

/** The npm-style patterns a root manifest declares, or `[]` when it declares none — including when
 * the file is absent, which is the same statement about membership. */
const npmPatternsAt = async (runner: Runner, opts: RangeOpts, rev: string): Promise<string[]> => {
  const contents = await showFile(runner, { dir: opts.dir, path: ROOT_MANIFEST, rev });
  if (contents === undefined) {
    return [];
  }
  try {
    const data = JSON.parse(contents) as Record<string, unknown>;
    return parseNpmWorkspaces(data['workspaces']);
  } catch {
    // Unparsable is not "declares nothing": a sentinel keeps it from comparing equal to an absent
    // or empty declaration, so the range is treated as one whose membership cannot be established.
    return ['\0unparsable'];
  }
};

const pnpmPatternsAt = async (runner: Runner, opts: RangeOpts, rev: string): Promise<string[]> => {
  const contents = await showFile(runner, { dir: opts.dir, path: PNPM_WORKSPACE_FILE, rev });
  return contents === undefined ? [] : collectPnpmPatterns(contents.split('\n'));
};

/** Both declarations at one revision, as one order-insensitive set — reordering patterns does not
 * change which directories they select. The two are namespaced apart so the same pattern written
 * in `package.json` and in `pnpm-workspace.yaml` is not mistaken for one moving between them. */
const declarationAt = async (
  runner: Runner,
  opts: RangeOpts,
  rev: string,
): Promise<Set<string>> => {
  const [npm, pnpm] = await Promise.all([
    npmPatternsAt(runner, opts, rev),
    pnpmPatternsAt(runner, opts, rev),
  ]);
  return new Set([
    ...npm.map((pattern) => `npm:${pattern}`),
    ...pnpm.map((pattern) => `pnpm:${pattern}`),
  ]);
};

const sameSet = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  left.size === right.size && [...left].every((value) => right.has(value));

/** Whether the range changed which directories the repository declares as workspace members.
 *
 * Only asked when one of the declaring files was touched at all; callers pass `touched: false` to
 * skip the reads entirely, which is the ordinary case. */
const declarationChanged = async (
  runner: Runner,
  opts: RangeOpts & { touched: boolean },
): Promise<boolean> => {
  if (!opts.touched) {
    return false;
  }
  const [before, after] = await Promise.all([
    declarationAt(runner, opts, opts.from),
    declarationAt(runner, opts, opts.to),
  ]);
  return !sameSet(before, after);
};

export { PNPM_WORKSPACE_FILE, ROOT_MANIFEST, declarationChanged };
