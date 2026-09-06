import { basename, dirname } from 'node:path';
import type { Runner } from '../proc/runner.ts';
import { extractPackageName } from '../workspaces-parse.ts';

// Which package NAMES the repository already had before a sync range — the evidence a caller needs
// to decide whether a package it can see now is genuinely new upstream.
//
// The question this answers is deliberately about identity, not about paths. Comparing a workspace
// scan against the configuration cannot distinguish a package that just arrived from one the ref's
// owner never wanted, because there is no inventory of what was there before; the sync range is
// that inventory. But "a manifest appeared at a path that had none" is the wrong reading of it,
// and wrong in both directions: a package renamed in place (`@acme/b` becoming `@acme/c` in the
// same directory) modifies its manifest rather than adding one and would be missed, while moving
// a deliberately untracked package to another directory adds a manifest path and would be
// announced as an arrival. Names answer both correctly.
//
// Only manifests the range CHANGED have to be read from history. An unchanged manifest is
// byte-identical at both ends, so its current name is also the name it had before — which is what
// keeps this to a handful of reads on a monorepo with a hundred packages.
//
// Best-effort throughout. Every failure resolves to `undefined`, meaning "nothing can be said",
// and the caller reports no arrivals: this only ever adds a finding to a sync that already
// succeeded, and a range git cannot walk (a shallow clone whose old sha is no longer reachable,
// most commonly) is a failure to look rather than evidence that a package is new.

const PACKAGE_MANIFEST = 'package.json';
const MANIFEST_PATHSPEC = '*package.json';
const SUCCESS_EXIT_CODE = 0;
const ROOT_DIR = '.';

/** Above this many changed manifests, the range is not the ordinary fetch this is for — a
 * repository-wide rewrite, or a merge of a long-lived branch — and reading every old blob would
 * cost more than the finding is worth. Reporting nothing is the safe direction. */
const MAX_CHANGED_MANIFESTS = 200;

type ArrivalsOpts = {
  dir: string;
  from: string;
  to: string;
};

/** What the caller needs to decide which of the packages it can see now are new: the directories
 * whose manifest this range touched, and the names those manifests carried BEFORE it. A package
 * at an untouched directory kept its name, so the caller supplies those from its own scan. */
type PackagesBefore = {
  changedDirs: readonly string[];
  namesBefore: readonly string[];
};

/** The pathspec also matches `mypackage.json` — verified against git 2.50, which prints both — so
 * the basename is what makes the selection exact. */
const isPackageManifest = (path: string): boolean => basename(path) === PACKAGE_MANIFEST;

/** Runs `git`, resolving `undefined` on any non-zero exit so a caller can treat a failure to look
 * as exactly that. */
const gitOutput = async (
  runner: Runner,
  dir: string,
  args: readonly string[],
): Promise<string | undefined> => {
  const result = await runner.run('git', [...args], { cwd: dir });
  return result.exitCode === SUCCESS_EXIT_CODE ? result.stdout : undefined;
};

/** Splits NUL-delimited git output into manifest paths.
 *
 * `-z` is not optional anywhere here. Under its default `core.quotePath`, git wraps a path holding
 * a non-ASCII byte in double quotes and C-escapes it, so `packages/café/package.json` arrives as
 * `"packages/caf\303\251/package.json"` — whose basename is `package.json"`, quote included, and
 * which therefore fails the check above. NUL delimiters suppress that quoting and carry the path
 * bytes through unchanged, which is also what makes a path containing a newline safe to split on.
 * Nothing is trimmed: a path may legitimately begin or end with a space. */
const manifestPaths = (stdout: string): string[] =>
  stdout.split('\0').filter((line) => line.length > 0 && isPackageManifest(line));

/** Every manifest path the range touched, in any way.
 *
 * `--no-renames` because rename detection is on by default and would pair a deletion with an
 * addition, hiding both behind one `R` entry — and two package manifests are almost always
 * similar enough for git to do it (verified: `R068` for two manifests differing only in `name`).
 * The pairing is a claim about history; what matters here is simply which paths were involved.
 *
 * `--` ends option parsing, for the same reason `cloneRepo` and `git remote set-url` use it. */
const changedManifests = async (
  runner: Runner,
  opts: ArrivalsOpts,
): Promise<string[] | undefined> => {
  const stdout = await gitOutput(runner, opts.dir, [
    'diff',
    '--name-only',
    '-z',
    '--no-renames',
    `${opts.from}..${opts.to}`,
    '--',
    MANIFEST_PATHSPEC,
  ]);
  return stdout === undefined ? undefined : manifestPaths(stdout);
};

/** Which of `paths` existed at `rev`, so a later read can tell "this file is new" apart from
 * "this file could not be read" — two answers a failing `git show` does not distinguish.
 *
 * The changed paths are passed as literal pathspecs rather than reusing the manifest glob:
 * `ls-tree` does not expand `*package.json` the way `diff` does (verified — it matches nothing),
 * and asking about exactly the paths in question is both exact and cheaper than listing a tree
 * that may hold thousands of files. */
const existingAmong = async (
  runner: Runner,
  opts: { dir: string; paths: readonly string[]; rev: string },
): Promise<Set<string> | undefined> => {
  if (opts.paths.length === 0) {
    return new Set();
  }
  const stdout = await gitOutput(runner, opts.dir, [
    'ls-tree',
    '-r',
    '-z',
    '--name-only',
    opts.rev,
    '--',
    ...opts.paths,
  ]);
  return stdout === undefined ? undefined : new Set(manifestPaths(stdout));
};

/** The package name one manifest declared at `rev`. `undefined` means the read or the parse
 * failed — never "it declared no name", which is a successful read reported as an empty result. */
const nameAt = async (
  runner: Runner,
  opts: { dir: string; path: string; rev: string },
): Promise<{ name: string | undefined } | undefined> => {
  const stdout = await gitOutput(runner, opts.dir, ['show', `${opts.rev}:${opts.path}`]);
  if (stdout === undefined) {
    return undefined;
  }
  try {
    const data = JSON.parse(stdout) as Record<string, unknown>;
    return { name: extractPackageName(data) };
  } catch {
    return undefined;
  }
};

/** Reads the pre-range name of every changed manifest that existed at `from`.
 *
 * One unreadable manifest fails the whole call rather than being skipped. A name we could not
 * read is a name we cannot rule out as pre-existing, and skipping it would let a package that was
 * there all along be announced as new — the one direction this must not fail in. */
const namesAtFrom = async (
  runner: Runner,
  opts: { dir: string; rev: string },
  paths: readonly string[],
): Promise<string[] | undefined> => {
  const names: string[] = [];
  for (const path of paths) {
    // Sequential on purpose: this runs inside a sync's per-ref lock, and a monorepo merge could
    // otherwise fan out into hundreds of concurrent git processes.
    // eslint-disable-next-line no-await-in-loop -- see above
    const read = await nameAt(runner, { dir: opts.dir, path, rev: opts.rev });
    if (read === undefined) {
      return undefined;
    }
    if (read.name !== undefined) {
      names.push(read.name);
    }
  }
  return names;
};

const NOTHING_BEFORE: PackagesBefore = { changedDirs: [], namesBefore: [] };

/** The directories a caller should reconsider. The repository root is never a workspace member —
 * `unregisteredRoot` owns that case and needs no range to find it — so it is not among them. */
const changedDirsOf = (changed: readonly string[]): string[] =>
  [...new Set(changed.map((path) => dirname(path)))].filter((dir) => dir !== ROOT_DIR).toSorted();

/** Reads the pre-range names for `changed`, once it is known which of those paths existed. */
const namesBeforeFor = async (
  runner: Runner,
  opts: ArrivalsOpts,
  changed: readonly string[],
): Promise<string[] | undefined> => {
  const present = await existingAmong(runner, { dir: opts.dir, paths: changed, rev: opts.from });
  if (present === undefined) {
    return undefined;
  }
  return namesAtFrom(
    runner,
    { dir: opts.dir, rev: opts.from },
    changed.filter((path) => present.has(path)),
  );
};

/** What the repository's packages looked like before this range, as far as it can be established.
 * `undefined` when it cannot be — which callers must read as "report nothing", never as "nothing
 * existed before". */
const packagesBefore = async (
  runner: Runner,
  opts: ArrivalsOpts,
): Promise<PackagesBefore | undefined> => {
  if (opts.from === opts.to) {
    return NOTHING_BEFORE;
  }
  const changed = await changedManifests(runner, opts);
  if (changed === undefined || changed.length > MAX_CHANGED_MANIFESTS) {
    return undefined;
  }
  const names = await namesBeforeFor(runner, opts, changed);
  return names === undefined
    ? undefined
    : { changedDirs: changedDirsOf(changed), namesBefore: names };
};

export { packagesBefore };
export type { PackagesBefore };
