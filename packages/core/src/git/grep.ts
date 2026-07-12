import type { Runner } from '../proc/runner.ts';
import { validationError } from '../errors.ts';

// Bounded `git grep` plumbing for `refs search` — a hint tool for coding agents, not a gate: the
// Caller gets at most `limit` matches plus an honest `truncated` flag, so it always knows when
// More matches exist beyond what it was shown. Built behind the `Runner` seam like `repo.ts`, on
// `Runner.run`'s "failure is data" contract (runner.ts never throws on a non-zero exit): exit 0
// Means matches, exit 1 is `git grep`'s documented clean no-match result (NOT an error), and any
// Other exit is a real failure surfaced as a `validationError` carrying git's own stderr.

interface GrepOpts {
  dir: string;
  limit: number;
  pathspecs: readonly string[];
  pattern: string;
}

interface GrepMatch {
  line: number;
  path: string;
  snippet: string;
}

interface GrepResult {
  matches: GrepMatch[];
  truncated: boolean;
}

const MATCHES_EXIT_CODE = 0;
const NO_MATCHES_EXIT_CODE = 1;
const NO_PATHSPECS = 0;
const SNIPPET_START = 0;
const NOT_FOUND = -1;
const FIRST_TOKEN = 0;
const SECOND_TOKEN = 1;
const TOKENS_PER_RECORD = 2;
const NEXT_CHAR = 1;
/** Hard cap on each returned snippet, so one pathological (e.g. minified) line cannot blow up the
 * structured output a coding agent has to ingest. */
const MAX_SNIPPET_LENGTH = 200;

// With `-z`, one `git grep -z -n` record is `<path> NUL <line> NUL <content> NEWLINE` (verified
// Empirically against git 2.50: BOTH separators become NUL, and path quoting is disabled
// Entirely, so a path containing `:` or even a real NEWLINE — both legal in a tracked repo — or
// Non-ASCII bytes comes back verbatim). That rules out splitting the stream on newlines: the
// Only safe walk is over NUL tokens, where token 3k is a path glued to the previous record's
// Content ("<content> NEWLINE <path>" — content runs to the FIRST newline, because a matched
// Line can never contain one; everything after it, newlines included, is the next path). Content
// Can never contain a NUL either: `-I` skips binary files.
const FIELD_SEPARATOR = '\0';
const LINE_NUMBER = /^\d+$/u;

interface GrepRecord {
  match: GrepMatch;
  nextPath: string;
}

// One record assembled from the pending `path` plus the two tokens at `index` (line number and
// The mixed "<content> NEWLINE <next-path>" token), or `undefined` when any of the three pieces
// — or the record-terminating newline inside the mixed token — is missing: an incomplete tail
// Fragment (empirically what every byte-cap cut point produces), dropped, never parsed.
const takeRecord = (
  tokens: readonly string[],
  index: number,
  path: string,
): GrepRecord | undefined => {
  const line = tokens[index];
  const mixed = tokens[index + SECOND_TOKEN];
  if (line === undefined || mixed === undefined || !LINE_NUMBER.test(line)) {
    return undefined;
  }
  const newlineAt = mixed.indexOf('\n');
  if (newlineAt === NOT_FOUND) {
    return undefined;
  }
  const content = mixed.slice(SNIPPET_START, newlineAt);
  return {
    match: {
      line: Number(line),
      path,
      snippet: content.trim().slice(SNIPPET_START, MAX_SNIPPET_LENGTH),
    },
    nextPath: mixed.slice(newlineAt + NEXT_CHAR),
  };
};

// State machine over the NUL tokens: each record consumes the pending path plus two tokens (see
// `takeRecord`), and each mixed token's post-newline remainder becomes the NEXT record's path.
const parseRecords = (stdout: string): GrepMatch[] => {
  const tokens = stdout.split(FIELD_SEPARATOR);
  const records: GrepMatch[] = [];
  let path = tokens[FIRST_TOKEN] ?? '';
  for (let index = SECOND_TOKEN; index < tokens.length; index += TOKENS_PER_RECORD) {
    const record = takeRecord(tokens, index, path);
    if (record === undefined) {
      break;
    }
    records.push(record.match);
    path = record.nextPath;
  }
  return records;
};

// Counts ALL complete records first (that is what keeps `truncated` honest), then returns only
// The first `limit` of them — reading just enough to know more exists without shipping it.
const parseGrepOutput = (stdout: string, limit: number): GrepResult => {
  const records = parseRecords(stdout);
  return { matches: records.slice(SNIPPET_START, limit), truncated: records.length > limit };
};

// When the runner's byte cap cut stdout mid-stream (`RunResult.stdoutTruncated`), the trailing
// Record may be an incomplete fragment of a real match — the state machine above already drops
// It (a cut record always lacks a delimiter, verified empirically at every cut position), and
// `truncated: true` is reported unconditionally: with output missing, the record count alone can
// No longer prove there was nothing beyond `limit`.
const parseByteCappedOutput = (stdout: string, limit: number): GrepResult => {
  const { matches } = parseGrepOutput(stdout, limit);
  return { matches, truncated: true };
};

// `-z` makes git emit NUL field separators and unquoted paths (see `parseMatchLine`), so no
// `core.quotePath` override is needed. `-e <pattern>` (never a bare positional) so a pattern
// Beginning with `-` can never be parsed as a git option; the `--` separator likewise guards
// Option-looking pathspecs.
const buildGrepArgs = (opts: GrepOpts): string[] => {
  const args = ['grep', '-z', '-n', '-I', '--extended-regexp', '-e', opts.pattern];
  if (opts.pathspecs.length > NO_PATHSPECS) {
    args.push('--', ...opts.pathspecs);
  }
  return args;
};

/** Runs `git grep -z -n -I --extended-regexp` in `opts.dir`, scoped to `opts.pathspecs` (when
 * any) and bounded to `opts.limit` matches; `truncated` reports whether git produced more match
 * lines than the limit — or, when the runner byte-capped stdout, that the output itself is
 * incomplete (the possibly-partial last line is dropped, never parsed). Exit 1 (no matches) is a
 * clean empty result; any exit other than 0/1 throws `validationError` with git's stderr. */
const grepCheckout = async (runner: Runner, opts: GrepOpts): Promise<GrepResult> => {
  const result = await runner.run('git', buildGrepArgs(opts), { cwd: opts.dir });
  if (result.exitCode === MATCHES_EXIT_CODE) {
    if (result.stdoutTruncated === true) {
      return parseByteCappedOutput(result.stdout, opts.limit);
    }
    return parseGrepOutput(result.stdout, opts.limit);
  }
  if (result.exitCode === NO_MATCHES_EXIT_CODE) {
    return { matches: [], truncated: false };
  }
  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
  throw validationError(`git grep failed: ${detail}`);
};

export { grepCheckout };
export type { GrepMatch, GrepOpts, GrepResult };
