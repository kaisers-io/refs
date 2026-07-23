import type { ChangedPath, RangeShortstat } from './range-parse.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { parseNameStatusStream, parseShortstat } from './range-parse.ts';
import type { Runner } from '../proc/runner.ts';
import { validationError } from '../errors.ts';

// Bounded, read-only git range queries powering `refs range <ref> <old> <new>`: commit count and
// Log over `<oldTag>..<newTag>`, shortstat/name-status diffs (optionally scoped to a package
// Path), and file content at a tag (which changelog.ts builds its capped CHANGELOG excerpt on).
// Every list here is bounded by an explicit caller-supplied limit so the CLI's one-envelope
// Contract stays token-efficient regardless of range size — and truncation is reported alongside
// The data, never silently applied. Output parsing lives in range-parse.ts (split for the
// Per-file line cap, like changelog.ts). Same `Runner` seam as repo.ts: real git via SpawnRunner
// In production, FakeRunner in unit tests.
//
// Hardening rules applied to every git invocation here:
// - Tags enter argv only as fully qualified `refs/tags/<tag>` revisions behind
//   `--end-of-options`, so a valid tag beginning with `-` (git accepts `refs/tags/-v1.0.0`) can
//   Never be parsed as an option. User-facing JSON keeps the bare tag names.
// - A configured package path enters argv only as a `:(literal)` pathspec, so fnmatch
//   Metacharacters in the configured path (`packages/br[a]ckets`) are never glob-expanded.

interface RangeBounds {
  newTag: string;
  oldTag: string;
}

interface RangeLogOpts extends RangeBounds {
  limit: number;
}

interface RangeDiffOpts extends RangeBounds {
  pathScope?: string;
}

interface RangePathsOpts extends RangeDiffOpts {
  limit: number;
}

interface RangeCommit {
  date: string;
  sha: string;
  subject: string;
}

interface BoundedChangedPaths {
  paths: ChangedPath[];
  truncated: boolean;
}

const SUCCESS_EXIT_CODE = 0;
const NONE = 0;
// `%h<TAB>%ad<TAB>%s` — tab separators survive any subject except one that itself embeds tabs,
// Which `parseCommitLine` handles by re-joining the trailing fields.
const LOG_FORMAT = '--pretty=format:%h%x09%ad%x09%s';

interface CommandSpec {
  action: string;
  args: readonly string[];
  cwd: string;
}

// Mirrors repo.ts's `runOrThrow`: these queries have no sane way to continue past a git failure
// (both tags were already verified by `resolveTag`, so a non-zero exit means a broken checkout).
const gitOrThrow = async (runner: Runner, spec: CommandSpec): Promise<string> => {
  const result = await runner.run('git', spec.args, { cwd: spec.cwd });
  if (result.exitCode === SUCCESS_EXIT_CODE) {
    return result.stdout;
  }
  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
  throw validationError(`${spec.action} failed: ${detail}`);
};

const qualifyTag = (tag: string): string => `refs/tags/${tag}`;

const spanOf = (bounds: RangeBounds): string =>
  `${qualifyTag(bounds.oldTag)}..${qualifyTag(bounds.newTag)}`;

// `-- :(literal)<path>` scoping for the diff queries; empty when the caller wants the whole tree.
const scopeArgs = (pathScope: string | undefined): string[] => {
  if (pathScope === undefined) {
    return [];
  }
  return ['--', `:(literal)${pathScope}`];
};

const nonEmptyLines = (stdout: string): string[] =>
  stdout.split('\n').filter((line) => line !== '');

/** Total number of non-merge commits in `<oldTag>..<newTag>` — the unbounded count reported next
 * to the bounded `listRangeCommits` slice so a consumer can always tell more commits exist. */
const countRangeCommits = async (
  runner: Runner,
  dir: string,
  bounds: RangeBounds,
): Promise<number> => {
  const stdout = await gitOrThrow(runner, {
    action: 'git rev-list --count',
    args: ['rev-list', '--count', '--no-merges', '--end-of-options', spanOf(bounds)],
    cwd: dir,
  });
  return Number(stdout.trim());
};

const parseCommitLine = (line: string): RangeCommit | undefined => {
  const [sha, date, ...subjectParts] = line.split('\t');
  if (sha === undefined || date === undefined || subjectParts.length === NONE) {
    return undefined;
  }
  return { date, sha, subject: subjectParts.join('\t') };
};

/** At most `opts.limit` non-merge commits in `<oldTag>..<newTag>`, newest first (git log's own
 * order); `[]` for an empty range. */
const listRangeCommits = async (
  runner: Runner,
  dir: string,
  opts: RangeLogOpts,
): Promise<RangeCommit[]> => {
  const stdout = await gitOrThrow(runner, {
    action: 'git log',
    args: [
      'log',
      '--no-merges',
      `--max-count=${String(opts.limit)}`,
      LOG_FORMAT,
      '--date=short',
      '--end-of-options',
      spanOf(opts),
    ],
    cwd: dir,
  });
  return nonEmptyLines(stdout)
    .map((line) => parseCommitLine(line))
    .filter((commit): commit is RangeCommit => commit !== undefined);
};

/** Aggregate diff stats for `<oldTag>..<newTag>`, optionally scoped to `opts.pathScope`. */
const rangeShortstat = async (
  runner: Runner,
  dir: string,
  opts: RangeDiffOpts,
): Promise<RangeShortstat> => {
  const stdout = await gitOrThrow(runner, {
    action: 'git diff --shortstat',
    args: ['diff', '--shortstat', '--end-of-options', spanOf(opts), ...scopeArgs(opts.pathScope)],
    cwd: dir,
  });
  return parseShortstat(stdout);
};

/** Changed paths in `<oldTag>..<newTag>` (optionally scoped), bounded to `opts.limit` entries with
 * an explicit `truncated` flag when more existed. */
const rangeNameStatus = async (
  runner: Runner,
  dir: string,
  opts: RangePathsOpts,
): Promise<BoundedChangedPaths> => {
  const stdout = await gitOrThrow(runner, {
    action: 'git diff --name-status',
    args: [
      'diff',
      '--name-status',
      '-z',
      '--end-of-options',
      spanOf(opts),
      ...scopeArgs(opts.pathScope),
    ],
    cwd: dir,
  });
  const paths = parseNameStatusStream(stdout);
  return { paths: paths.slice(NONE, opts.limit), truncated: paths.length > opts.limit };
};

interface FileAtTag {
  path: string;
  tag: string;
}

// `git show <tag>:<path>` exits non-zero both for a genuinely absent file (absence is data here,
// See `showFileAtTag`'s contract) and for real failures (unresolvable revision, corrupt object
// Store, unreadable checkout, ...). Only stderr matching one of git's PATH-absence messages may
// Map to `undefined`; anything else — including revision-level failures like `invalid object
// Name` or `bad revision` — must surface as an error, or a transient failure would silently
// Masquerade as "no changelog at this tag".
const ABSENT_AT_TAG_PATTERN = /does not exist in|exists on disk, but not in/iu;

/** Content of `target.path` as committed at `target.tag` (`git show refs/tags/<tag>:<path>`), or
 * `undefined` when the file does not exist at that tag — absence is data here, not an error.
 * Any OTHER `git show` failure (including an unresolvable tag) throws `validationError` carrying
 * git's stderr. */
const showFileAtTag = async (
  runner: Runner,
  dir: string,
  target: FileAtTag,
): Promise<string | undefined> => {
  const rev = `${qualifyTag(target.tag)}:${target.path}`;
  const result = await runner.run('git', ['show', '--end-of-options', rev], { cwd: dir });
  if (result.exitCode === SUCCESS_EXIT_CODE) {
    return result.stdout;
  }
  if (ABSENT_AT_TAG_PATTERN.test(result.stderr)) {
    return undefined;
  }
  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
  throw validationError(`git show failed: ${detail}`);
};

export { countRangeCommits, listRangeCommits, rangeNameStatus, rangeShortstat, showFileAtTag };
export type {
  BoundedChangedPaths,
  RangeBounds,
  RangeCommit,
  RangeDiffOpts,
  RangeLogOpts,
  RangePathsOpts,
};
export type { ChangedPath, RangeShortstat } from './range-parse.ts';
