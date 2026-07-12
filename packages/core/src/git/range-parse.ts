import { validationError } from '../errors.ts';

// Pure output parsers for git/range.ts's diff queries — split out of range.ts (exactly like
// Changelog.ts) purely to keep that file under the repo's 300-line cap. Two parsers live here:
// The `--shortstat` line (fail closed: empty output is a valid all-zero diff, nonempty output
// That doesn't match the expected shape throws) and the NUL-field `--name-status -z` stream
// (delimiter-proof: paths come back verbatim, so tabs/newlines/colons in tracked file names
// Survive intact — layout verified empirically against git 2.50).

interface RangeShortstat {
  deletions: number;
  files_changed: number;
  insertions: number;
}

interface ChangedPath {
  path: string;
  status: string;
}

const NONE = 0;
const STATUS_START = 0;
const STATUS_LENGTH = 1;
// In the NUL-field `--name-status -z` stream a rename/copy record carries TWO paths, every other
// Status exactly one.
const RENAME_OR_COPY_STATUS = /^[CR]/u;
const SINGLE_PATH_FIELDS = 1;
const PAIRED_PATH_FIELDS = 2;
const NEXT_FIELD = 1;
// Cap on how much unparseable git output a thrown error message carries.
const ERROR_DETAIL_LENGTH = 200;
const DETAIL_START = 0;
// Anchored to the WHOLE output (only surrounding whitespace/newlines tolerated): a
// Valid-looking shortstat embedded in warnings or trailing garbage must fail closed too, never
// Be fished out of output the parser does not actually understand.
const SHORTSTAT_PATTERN =
  /^\s*(?<files>\d+) files? changed(?:, (?<insertions>\d+) insertions?\(\+\))?(?:, (?<deletions>\d+) deletions?\(-\))?\s*$/u;

const countOf = (raw: string | undefined): number => {
  if (raw === undefined) {
    return NONE;
  }
  return Number(raw);
};

/** An empty `--shortstat` output (identical trees, or nothing under the path scope) is a valid
 * all-zero result. NONEMPTY output that does not match the expected shape throws instead of
 * silently reporting "no files changed" — that would hide parser drift or unexpected git
 * output. */
const parseShortstat = (stdout: string): RangeShortstat => {
  if (stdout.trim() === '') {
    return { deletions: NONE, files_changed: NONE, insertions: NONE };
  }
  const match = SHORTSTAT_PATTERN.exec(stdout);
  if (match === null) {
    const detail = stdout.trim().slice(DETAIL_START, ERROR_DETAIL_LENGTH);
    throw validationError(`git diff --shortstat returned unrecognized output: ${detail}`);
  }
  const { deletions, files, insertions } = match.groups ?? {};
  return {
    deletions: countOf(deletions),
    files_changed: countOf(files),
    insertions: countOf(insertions),
  };
};

// A rename/copy record spans two path fields (`R<score> NUL <old> NUL <new>`) — the path
// Reported is the one the file lives at in the NEW tree; every other record carries one path.
const pathFieldCount = (status: string): number => {
  if (RENAME_OR_COPY_STATUS.test(status)) {
    return PAIRED_PATH_FIELDS;
  }
  return SINGLE_PATH_FIELDS;
};

interface NameStatusRecord {
  entry: ChangedPath;
  next: number;
}

// One record starting at `fields[index]`, or `undefined` at the stream's trailing empty field
// (the output ends in NUL) or on a malformed tail.
const takeNameStatusRecord = (
  fields: readonly string[],
  index: number,
): NameStatusRecord | undefined => {
  const status = fields[index];
  if (status === undefined || status === '') {
    return undefined;
  }
  const count = pathFieldCount(status);
  const path = fields[index + count];
  if (path === undefined) {
    return undefined;
  }
  return {
    entry: { path, status: status.slice(STATUS_START, STATUS_LENGTH) },
    next: index + count + NEXT_FIELD,
  };
};

/** Parses `--name-status -z` output — one flat NUL-separated field stream (`STATUS NUL path NUL
 * ...`, trailing NUL last) with paths verbatim, normalized to `{path, status}` entries carrying
 * the NEW path and the first status character (`R100` → `R`). */
const parseNameStatusStream = (stdout: string): ChangedPath[] => {
  const fields = stdout.split('\0');
  const paths: ChangedPath[] = [];
  let index = 0;
  while (index < fields.length) {
    const record = takeNameStatusRecord(fields, index);
    if (record === undefined) {
      break;
    }
    paths.push(record.entry);
    index = record.next;
  }
  return paths;
};

export { parseNameStatusStream, parseShortstat };
export type { ChangedPath, RangeShortstat };
