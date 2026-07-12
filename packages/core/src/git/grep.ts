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
const LAST_LINE = -1;
/** Hard cap on each returned snippet, so one pathological (e.g. minified) line cannot blow up the
 * structured output a coding agent has to ingest. */
const MAX_SNIPPET_LENGTH = 200;

// One `git grep -n` output line: `<path>:<line>:<content>`. `[^:]+` deliberately stops the path
// At the first colon — the safe-segment rules (schemas/primitives.ts) already forbid colons in
// The paths this tool manages, and `git grep` itself never emits one before the line number.
const MATCH_LINE = /^(?<path>[^:]+):(?<line>\d+):(?<content>.*)$/u;

const parseMatchLine = (raw: string): GrepMatch | undefined => {
  const groups = MATCH_LINE.exec(raw)?.groups;
  const path = groups?.['path'];
  const line = groups?.['line'];
  const content = groups?.['content'];
  if (path === undefined || line === undefined || content === undefined) {
    return undefined;
  }
  return {
    line: Number(line),
    path,
    snippet: content.trim().slice(SNIPPET_START, MAX_SNIPPET_LENGTH),
  };
};

// Counts ALL produced lines first (that is what keeps `truncated` honest), then parses only the
// First `limit` of them — reading just enough to know more exists without shipping it.
const parseGrepOutput = (stdout: string, limit: number): GrepResult => {
  const lines = stdout.split('\n').filter((line) => line !== '');
  const matches = lines
    .slice(SNIPPET_START, limit)
    .map((raw) => parseMatchLine(raw))
    .filter((match) => match !== undefined);
  return { matches, truncated: lines.length > limit };
};

// When the runner's byte cap cut stdout mid-stream (`RunResult.stdoutTruncated`), the LAST line
// May be an incomplete fragment of a real match — drop it rather than parse a garbled
// Path/snippet, and report `truncated: true` unconditionally: with output missing, the line
// Count alone can no longer prove there was nothing beyond `limit`.
const parseByteCappedOutput = (stdout: string, limit: number): GrepResult => {
  const whole = stdout.split('\n').slice(SNIPPET_START, LAST_LINE).join('\n');
  const { matches } = parseGrepOutput(whole, limit);
  return { matches, truncated: true };
};

// `-c core.quotePath=false` (a git-level flag, so it must precede the subcommand) stops git from
// Octal-escaping non-ASCII bytes in paths (`"caf\303\251.txt"`) — matches come back with the
// Real file name. `-e <pattern>` (never a bare positional) so a pattern beginning with `-` can
// Never be parsed as a git option; the `--` separator likewise guards option-looking pathspecs.
const buildGrepArgs = (opts: GrepOpts): string[] => {
  const args = [
    '-c',
    'core.quotePath=false',
    'grep',
    '-n',
    '-I',
    '--extended-regexp',
    '-e',
    opts.pattern,
  ];
  if (opts.pathspecs.length > NO_PATHSPECS) {
    args.push('--', ...opts.pathspecs);
  }
  return args;
};

/** Runs `git grep -n -I --extended-regexp` in `opts.dir`, scoped to `opts.pathspecs` (when any)
 * and bounded to `opts.limit` matches; `truncated` reports whether git produced more match lines
 * than the limit — or, when the runner byte-capped stdout, that the output itself is incomplete
 * (the possibly-partial last line is dropped, never parsed). Exit 1 (no matches) is a clean
 * empty result; any exit other than 0/1 throws `validationError` with git's stderr. */
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
