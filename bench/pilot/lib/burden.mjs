// Objective retrieval-burden measurement, read straight from the RAW checkout via
// read-only git — never mutated. search-burden and range-burden are DIFFERENT
// constructs (a task can be search-heavy without spanning a wide version range, or
// vice versa) and are deliberately kept as two SEPARATE component objects rather than
// folded into one opaque score, per the cross-model review finding.

import { spawnExec } from './exec.mjs';

const OK_EXIT = 0;
const GIT_GREP_NO_MATCH_EXIT = 1;
const EMPTY = '';
const NEWLINE = '\n';
const ZERO = 0;
const FIRST = 0;
const REFS_TAGS_PREFIX = 'refs/tags/';
const SHORTSTAT_FILES_RE = /(?<files>\d+) files? changed/u;
const SHORTSTAT_INSERTIONS_RE = /(?<insertions>\d+) insertions?\(\+\)/u;
const SHORTSTAT_DELETIONS_RE = /(?<deletions>\d+) deletions?\(-\)/u;

const nonEmptyLines = (text) => text.split(NEWLINE).filter((line) => line !== EMPTY);

// `git grep` exits 1 on zero matches — that is a valid "0 hits" result, not a failure.
// Any other non-zero exit (bad repo, bad pattern, etc.) is a real error.
const gitGrep = async (checkoutPath, grepArgs) => {
  const { code, stderr, stdout } = await spawnExec(
    'git',
    ['-C', checkoutPath, 'grep', ...grepArgs],
    {},
  );
  if (code === GIT_GREP_NO_MATCH_EXIT) {
    return EMPTY;
  }
  if (code !== OK_EXIT) {
    throw new Error(`git grep failed (exit ${code}) for ${JSON.stringify(grepArgs)}: ${stderr}`);
  }
  return stdout;
};

// The frozen, exact `git grep` invocation the caller supplies (grepArgs) IS the
// baseline_query — this function never chooses or widens the query itself.
const measureSearchBurden = async (checkoutPath, grepArgs) => {
  const output = await gitGrep(checkoutPath, grepArgs);
  const lines = nonEmptyLines(output);
  const files = new Set(lines.map((line) => line.split(':')[FIRST]));
  return {
    distinct_files: files.size,
    grep_hits: lines.length,
    output_bytes: Buffer.byteLength(output, 'utf8'),
  };
};

// Thin wrapper matching the brief's named interface (grep_hits + output_bytes only);
// measureSearchBurden is the real API and also carries distinct_files.
const measureBurden = async (checkoutPath, grepArgs) => {
  const { grep_hits, output_bytes } = await measureSearchBurden(checkoutPath, grepArgs);
  return { grep_hits, output_bytes };
};

// Resolves a tag to a full commit sha via a fully-qualified refs/tags/<tag> ref (never
// a bare tag name), so a tag that happens to look like a flag can't be misparsed as one.
// Returns undefined (never a fabricated sha) when the tag doesn't resolve.
const resolveTag = async (checkoutPath, tag) => {
  const { code, stdout } = await spawnExec(
    'git',
    ['-C', checkoutPath, 'rev-parse', '--verify', `${REFS_TAGS_PREFIX}${tag}`],
    {},
  );
  if (code !== OK_EXIT) {
    return;
  }
  return stdout.trim();
};

const parseShortstat = (text) => ({
  changed_paths: Number(text.match(SHORTSTAT_FILES_RE)?.groups?.files ?? ZERO),
  deletions: Number(text.match(SHORTSTAT_DELETIONS_RE)?.groups?.deletions ?? ZERO),
  insertions: Number(text.match(SHORTSTAT_INSERTIONS_RE)?.groups?.insertions ?? ZERO),
});

const commitCount = async (checkoutPath, range) => {
  const { stdout } = await spawnExec(
    'git',
    ['-C', checkoutPath, 'log', range, '--oneline', '--no-merges'],
    {},
  );
  return nonEmptyLines(stdout).length;
};

const shortstat = async (checkoutPath, range) => {
  const { stdout } = await spawnExec('git', ['-C', checkoutPath, 'diff', range, '--shortstat'], {});
  return parseShortstat(stdout);
};

// Records the SIZE of a version range (v_old..v_new): commits, changed paths, and
// insertions/deletions — a proxy for how much a `range`-target task would need to
// wade through without a bounded diff helper. Undefined (not a fabricated zero) if
// either tag doesn't resolve against this checkout.
const measureRangeBurden = async (checkoutPath, oldTag, newTag) => {
  const [oldSha, newSha] = await Promise.all([
    resolveTag(checkoutPath, oldTag),
    resolveTag(checkoutPath, newTag),
  ]);
  if (oldSha === undefined || newSha === undefined) {
    return;
  }
  const range = `${oldSha}..${newSha}`;
  const [count, stat] = await Promise.all([
    commitCount(checkoutPath, range),
    shortstat(checkoutPath, range),
  ]);
  return { commit_count: count, ...stat };
};

export { measureBurden, measureRangeBurden, measureSearchBurden };
