import type { Runner } from '../proc/runner.ts';
import { validationError } from '../errors.ts';

// Bounded, read-only git range queries powering `refs range <ref> <old> <new>`: commit count and
// Log over `<oldTag>..<newTag>`, shortstat/name-status diffs (optionally scoped to a package
// Path), and file content at a tag (which changelog.ts builds its capped CHANGELOG excerpt on).
// Every list here is bounded by an explicit caller-supplied limit so the CLI's one-envelope
// Contract stays token-efficient regardless of range size — and truncation is reported alongside
// The data, never silently applied. Same `Runner` seam as repo.ts: real git via SpawnRunner in
// Production, FakeRunner in unit tests.

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

interface RangeShortstat {
  deletions: number;
  files_changed: number;
  insertions: number;
}

interface ChangedPath {
  path: string;
  status: string;
}

interface BoundedChangedPaths {
  paths: ChangedPath[];
  truncated: boolean;
}

const SUCCESS_EXIT_CODE = 0;
const NONE = 0;
const LAST_FIELD = -1;
const STATUS_START = 0;
const STATUS_LENGTH = 1;
// A name-status line is at least `<status>\t<path>`; anything shorter is not a diff entry.
const MIN_NAME_STATUS_FIELDS = 2;
// `%h<TAB>%ad<TAB>%s` — tab separators survive any subject except one that itself embeds tabs,
// Which `parseCommitLine` handles by re-joining the trailing fields.
const LOG_FORMAT = '--pretty=format:%h%x09%ad%x09%s';
const SHORTSTAT_PATTERN =
  /(?<files>\d+) files? changed(?:, (?<insertions>\d+) insertions?\(\+\))?(?:, (?<deletions>\d+) deletions?\(-\))?/u;

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

const spanOf = (bounds: RangeBounds): string => `${bounds.oldTag}..${bounds.newTag}`;

// `-- <path>` scoping for the diff queries; empty when the caller wants the whole tree.
const scopeArgs = (pathScope: string | undefined): string[] => {
  if (pathScope === undefined) {
    return [];
  }
  return ['--', pathScope];
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
    args: ['rev-list', '--count', '--no-merges', spanOf(bounds)],
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
      spanOf(opts),
    ],
    cwd: dir,
  });
  return nonEmptyLines(stdout)
    .map((line) => parseCommitLine(line))
    .filter((commit): commit is RangeCommit => commit !== undefined);
};

const countOf = (raw: string | undefined): number => {
  if (raw === undefined) {
    return NONE;
  }
  return Number(raw);
};

// An empty `--shortstat` output (identical trees, or nothing under the path scope) is a valid
// All-zero result, not a parse failure.
const parseShortstat = (stdout: string): RangeShortstat => {
  const match = SHORTSTAT_PATTERN.exec(stdout);
  if (match === null) {
    return { deletions: NONE, files_changed: NONE, insertions: NONE };
  }
  const { deletions, files, insertions } = match.groups ?? {};
  return {
    deletions: countOf(deletions),
    files_changed: countOf(files),
    insertions: countOf(insertions),
  };
};

/** Aggregate diff stats for `<oldTag>..<newTag>`, optionally scoped to `opts.pathScope`. */
const rangeShortstat = async (
  runner: Runner,
  dir: string,
  opts: RangeDiffOpts,
): Promise<RangeShortstat> => {
  const stdout = await gitOrThrow(runner, {
    action: 'git diff --shortstat',
    args: ['diff', '--shortstat', spanOf(opts), ...scopeArgs(opts.pathScope)],
    cwd: dir,
  });
  return parseShortstat(stdout);
};

// A rename/copy line is `R<score>\t<old>\t<new>` — the LAST field is always the path the file
// Lives at in the new tree, and the status letter is the first character (`R100` → `R`).
const parsePathLine = (line: string): ChangedPath | undefined => {
  const fields = line.split('\t');
  const [status] = fields;
  const path = fields.at(LAST_FIELD);
  if (status === undefined || path === undefined || fields.length < MIN_NAME_STATUS_FIELDS) {
    return undefined;
  }
  return { path, status: status.slice(STATUS_START, STATUS_LENGTH) };
};

/** Changed paths in `<oldTag>..<newTag>` (optionally scoped), bounded to `opts.limit` entries with
 * an explicit `truncated` flag when more existed. */
const rangeNameStatus = async (
  runner: Runner,
  dir: string,
  opts: RangePathsOpts,
): Promise<BoundedChangedPaths> => {
  // `-c core.quotePath=false` (a git-level flag, so it must precede the subcommand) stops git
  // From octal-escaping non-ASCII bytes in paths (`"caf\303\251.txt"`) — the returned entries
  // Carry the real file names.
  const stdout = await gitOrThrow(runner, {
    action: 'git diff --name-status',
    args: [
      '-c',
      'core.quotePath=false',
      'diff',
      '--name-status',
      spanOf(opts),
      ...scopeArgs(opts.pathScope),
    ],
    cwd: dir,
  });
  const paths = nonEmptyLines(stdout)
    .map((line) => parsePathLine(line))
    .filter((entry): entry is ChangedPath => entry !== undefined);
  return { paths: paths.slice(NONE, opts.limit), truncated: paths.length > opts.limit };
};

interface FileAtTag {
  path: string;
  tag: string;
}

// `git show <tag>:<path>` exits non-zero both for a genuinely absent file (absence is data here,
// See `showFileAtTag`'s contract) and for real failures (corrupt object store, unreadable
// Checkout, ...). Only stderr matching one of git's known "that path/object isn't there"
// Messages may map to `undefined`; anything else must surface as an error, or a transient
// Failure would silently masquerade as "no changelog at this tag".
const ABSENT_AT_TAG_PATTERN =
  /does not exist in|exists on disk, but not in|invalid object name|bad revision|Not a valid object name/iu;

/** Content of `target.path` as committed at `target.tag` (`git show <tag>:<path>`), or
 * `undefined` when the file does not exist at that tag — absence is data here, not an error.
 * Any OTHER `git show` failure throws `validationError` carrying git's stderr. */
const showFileAtTag = async (
  runner: Runner,
  dir: string,
  target: FileAtTag,
): Promise<string | undefined> => {
  const result = await runner.run('git', ['show', `${target.tag}:${target.path}`], { cwd: dir });
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
  ChangedPath,
  RangeBounds,
  RangeCommit,
  RangeDiffOpts,
  RangeLogOpts,
  RangePathsOpts,
  RangeShortstat,
};
