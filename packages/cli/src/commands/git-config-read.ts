// A read-only, subset parser for `.git/config`, used to establish a checkout's identity without
// spawning `git`.
//
// `refs resolve` runs on the hot path of every source question and currently spawns no subprocess
// at all, which is worth keeping — so the two values that identify a managed checkout (the
// `core.hooksPath` marker `cloneRepo` stamps, and `remote.origin.url`) are read from the file
// directly.
//
// Line matching would not do. Git's config format allows repeated sections, arbitrary whitespace,
// `#`/`;` comments, quoted values with escapes, and line continuations, and it compares section and
// variable names case-INSENSITIVELY while comparing subsection names case-SENSITIVELY. A grep for
// `hooksPath` would be fooled by a comment, and one for `url` by a second remote.
//
// It deliberately does NOT implement `include`/`includeIf`, nor `url.<base>.insteadOf` rewriting.
// Both values are written into the local config by the clone that created the checkout, so they are
// expected to be physically present — and git itself disables includes when a specific config scope
// is selected, which is what the existing `git config --local` marker check already relied on.
// The limit that follows is real and stated on `sameRepository` in `resolve-checkout.ts`: a config
// carrying an `insteadOf` rewrite would fetch from a url this reader does not compute.
//
// Every value seen is returned, not the last one, so the caller can fail closed on a duplicate
// rather than guess at first-versus-last precedence.
//
// And it is strict about what it accepts. Anything git itself would reject — an unterminated quote,
// an escape git does not define, a line that is neither a section header nor an assignment — makes
// the whole read fail rather than being skipped. A lenient parser would let a corrupt or crafted
// config still yield the marker and origin, and so still be reported as a managed checkout; the
// point of reading this file is to establish identity, and a file git would not accept is not
// evidence of anything.

// Git allows only alphanumerics, `-` and `.` in a section name, and only alphanumerics and `-`
// in a variable name — notably no underscore, which `\w` would have admitted.
// A trailing comment after the closing bracket is valid: `[core] # local settings`.
// Git's config whitespace is space and horizontal tab only — JavaScript's `\s` additionally covers
// unicode spaces and vertical whitespace, which git would not strip.
const SECTION_LINE =
  /^\[[ \t]*(?<section>[A-Za-z0-9.-]+)[ \t]*(?:"(?<subsection>(?:[^"\\]|\\.)*)")?[ \t]*\][ \t]*(?:[#;].*)?$/u;
const VARIABLE_LINE = /^(?<name>[A-Za-z][A-Za-z0-9-]*)[ \t]*(?:=[ \t]*(?<value>.*))?$/u;
// The only escapes git defines inside a config VALUE. Anything else is a malformed file.
// eslint-disable-next-line id-length -- keys are the literal escape characters git defines (b/n/t)
const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', b: '\b', n: '\n', t: '\t' };
// Inside a SUBSECTION name git recognises only these two; the rest are not escapes there.
const SUBSECTION_ESCAPES: Record<string, string> = { '"': '"', '\\': '\\' };
// Git treats only space and horizontal tab as trimmable config whitespace.
const CONFIG_SPACE = new Set([' ', '\t']);
const CRLF = 2;

/** Splits `text` into git's LOGICAL lines, honouring the one thing a lexical split cannot: whether
 * a trailing backslash is actually a continuation.
 *
 * It is not one inside a comment. Git reads
 *
 *     hooksPath = /expected # note \
 *     hooksPath = /attacker
 *
 * as two assignments and resolves the setting to `/attacker`. Joining first and stripping the
 * comment afterwards would see only `/expected` — hiding both the value git actually uses and the
 * duplicate that would otherwise fail the read closed. A config could then present the expected
 * marker and origin while git identified the repository as something else entirely.
 *
 * Nor is a backslash a continuation when it is itself escaped: `\\` at end of line is a literal
 * backslash. Both cases need the quote/comment/escape state carried across the scan, which is why
 * this walks characters rather than lines. */
// eslint-disable-next-line max-statements -- a scanner whose branches all depend on the quote/comment/escape state the others maintain; splitting it would thread that state through helpers and read worse than the single pass it is
const logicalLines = function* logicalLines(text: string): Generator<string> {
  let current = '';
  let quoted = false;
  let commented = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\n') {
      yield current;
      current = '';
      quoted = false;
      commented = false;
    } else if (char === '\r' && text[index + 1] === '\n') {
      // Part of a CRLF line ending; the \n on the next pass closes the logical line. A lone \r is
      // an ordinary character to git and falls through to the branches below.
    } else if (commented) {
      current += char;
    } else if (char === '\\') {
      const next = text[index + 1];
      if (next === '\n' || (next === '\r' && text[index + CRLF] === '\n')) {
        // A real continuation: consume the newline and keep building the same logical line.
        index += next === '\r' ? CRLF : 1;
      } else {
        // An escape. Both characters belong to the value, and neither can start a comment.
        current += char + (next ?? '');
        index += 1;
      }
    } else {
      if (char === '"') {
        quoted = !quoted;
      } else if (!quoted && (char === '#' || char === ';')) {
        commented = true;
      }
      current += char;
    }
  }
  if (current !== '') {
    yield current;
  }
};

const MALFORMED = Symbol('malformed git config');
type Decoded = string | typeof MALFORMED;

type DecodedChar = { char: string; quoted: boolean };

const isTrimmable = (entry: DecodedChar | undefined): boolean =>
  entry !== undefined && !entry.quoted && CONFIG_SPACE.has(entry.char);

/** Drops leading and trailing whitespace that was NOT inside quotes.
 *
 * A plain `trim()` would be wrong in a way that matters: git treats `[remote " origin "]` as a
 * subsection distinct from `origin`, so trimming quoted space would let a config declaring only
 * `" origin "` satisfy a check for `origin` — and a checkout with no origin remote at all would
 * read as managed. Quoted whitespace is part of the value; unquoted whitespace is layout. */
const trimUnquoted = (chars: readonly DecodedChar[]): string => {
  let start = 0;
  let end = chars.length;
  while (start < end && isTrimmable(chars[start])) {
    start += 1;
  }
  while (end > start && isTrimmable(chars[end - 1])) {
    end -= 1;
  }
  return chars
    .slice(start, end)
    .map((entry) => entry.char)
    .join('');
};

// eslint-disable-next-line max-statements -- one pass over the characters, where each branch depends on the quoting state the others maintain; splitting it would need that state threaded through helpers and read worse
const decodeValue = (raw: string): Decoded => {
  const chars: DecodedChar[] = [];
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '\\') {
      index += 1;
      // Git defines exactly five escapes; anything else makes the file invalid rather than
      // standing for itself.
      const escaped = ESCAPES[raw[index] ?? ''];
      if (escaped === undefined) {
        return MALFORMED;
      }
      // An escaped character is literal wherever it appears, so it is never trimmable.
      chars.push({ char: escaped, quoted: true });
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && (char === '#' || char === ';')) {
      return trimUnquoted(chars);
    } else {
      chars.push({ char: char ?? '', quoted });
    }
  }
  // An unterminated quote is not a value with a stray character in it; git rejects the file.
  return quoted ? MALFORMED : trimUnquoted(chars);
};

type Section = { name: string; subsection?: string };

/** The fully-qualified key a variable in `section` is recorded under: `core.hookspath`,
 * `remote.origin.url`. Section and variable names are lowercased because git compares them
 * case-insensitively; the subsection keeps its case because git does not. */
const qualify = (section: Section, name: string): string =>
  section.subsection === undefined
    ? `${section.name}.${name.toLowerCase()}`
    : `${section.name}.${section.subsection}.${name.toLowerCase()}`;

/** Subsection names are taken verbatim apart from `\"` and `\\`; git does not apply the value
 * escapes (`\n`, `\t`, `\b`) there, and neither does trimming — the quotes delimit exactly. */
// eslint-disable-next-line max-statements -- the same character-at-a-time shape as `decodeValue`, with its own narrower escape set
const decodeSubsection = (raw: string): Decoded => {
  let out = '';
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '\\') {
      index += 1;
      const escaped = SUBSECTION_ESCAPES[raw[index] ?? ''];
      if (escaped === undefined) {
        return MALFORMED;
      }
      out += escaped;
    } else {
      out += char ?? '';
    }
  }
  return out;
};

const parseSection = (line: string): Section | typeof MALFORMED | undefined => {
  const match = SECTION_LINE.exec(line);
  if (match?.groups === undefined) {
    return undefined;
  }
  const { section, subsection } = match.groups;
  if (section === undefined) {
    return undefined;
  }
  if (subsection === undefined) {
    return { name: section.toLowerCase() };
  }
  const decoded = decodeSubsection(subsection);
  return decoded === MALFORMED ? MALFORMED : { name: section.toLowerCase(), subsection: decoded };
};

// `String.trim()` would be wrong here for the same reason `\s` is: it strips unicode whitespace,
// which git keeps. Only leading/trailing space and tab are layout.
const CONFIG_SPACE_EDGES = /^[ \t]+|[ \t]+$/gu;

const trimConfig = (line: string): string => line.replace(CONFIG_SPACE_EDGES, '');

const isSkippable = (line: string): boolean =>
  line === '' || line.startsWith('#') || line.startsWith(';');

/** Records one variable line under the section currently in effect, if it is one of the wanted keys.
 *
 * A bare `name` with no `=` is git's boolean true; it is recorded as an empty string, which no
 * caller here accepts as a usable value. */
/** The `name = value` an assignment line carries, or `MALFORMED` for a line git would reject —
 * which includes one that is neither a section header nor an assignment at all. */
const parseAssignment = (line: string): { name: string; value: string } | typeof MALFORMED => {
  const variable = VARIABLE_LINE.exec(line);
  const name = variable?.groups?.['name'];
  if (name === undefined) {
    return MALFORMED;
  }
  const value = decodeValue(variable?.groups?.['value'] ?? '');
  return value === MALFORMED ? MALFORMED : { name, value };
};

const recordVariable = (
  found: Map<string, string[]>,
  opts: { line: string; section: Section; wanted: readonly string[] },
): 'malformed' | 'ok' => {
  const assignment = parseAssignment(opts.line);
  if (assignment === MALFORMED) {
    return 'malformed';
  }
  const key = qualify(opts.section, assignment.name);
  if (opts.wanted.includes(key)) {
    found.set(key, [...(found.get(key) ?? []), assignment.value]);
  }
  return 'ok';
};

/** Applies one non-blank line: either it opens a section, or it assigns a variable within the
 * current one. Returns the section in effect afterwards, or `MALFORMED` for a line git would
 * reject. */
const consumeLine = (
  found: Map<string, string[]>,
  opts: { line: string; section: Section; wanted: readonly string[] },
): Section | typeof MALFORMED => {
  const parsed = parseSection(opts.line);
  if (parsed !== undefined) {
    return parsed;
  }
  if (opts.section === NO_SECTION) {
    // An assignment before any section header. Git rejects the file; skipping the line would let
    // the rest of a malformed config still yield a marker and an origin.
    return MALFORMED;
  }
  return recordVariable(found, opts) === 'malformed' ? MALFORMED : opts.section;
};

// Stands in for "no section has been opened yet". Git rejects an assignment before the first
// section header, so reaching `recordVariable` with this is a malformed file rather than a line to
// skip — the empty name is what `qualify` turns into a key no caller ever wants, and the guard in
// `consumeLine` refuses it outright.
const NO_SECTION: Section = { name: '' };

/** Every value in `text` for each requested key, in file order — or `undefined` when the file is
 * not one git would accept.
 *
 * A key with no entry was not present; a key with more than one was set more than once, which
 * callers treat as reason to fail closed. */
const readGitConfigValues = (
  text: string,
  wanted: readonly string[],
): ReadonlyMap<string, string[]> | undefined => {
  const found = new Map<string, string[]>();
  let section = NO_SECTION;
  for (const line of logicalLines(text)) {
    const trimmed = trimConfig(line);
    const next = isSkippable(trimmed)
      ? section
      : consumeLine(found, { line: trimmed, section, wanted });
    if (next === MALFORMED) {
      return undefined;
    }
    section = next;
  }
  return found;
};

export { readGitConfigValues };
