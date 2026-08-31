import { MALFORMED, decodeSubsection, decodeValue, trimConfig } from './git-config-value.ts';
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
// Matches only the header, not the whole line: git allows a comment (`[core] # note`) AND an
// assignment (`[core] hooksPath = /hooks`) to follow one on the same line.
//
// Git's config whitespace is space and horizontal tab only — JavaScript's `\s` additionally covers
// unicode spaces and vertical whitespace, which git would not strip.
const SECTION_PREFIX =
  /^\[[ \t]*(?<section>[A-Za-z0-9.-]+)[ \t]*(?:"(?<subsection>(?:[^"\\]|\\.)*)")?[ \t]*\]/u;
const VARIABLE_LINE = /^(?<name>[A-Za-z][A-Za-z0-9-]*)[ \t]*(?:=[ \t]*(?<value>.*))?$/u;
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

type Section = { name: string; subsection?: string };

/** The fully-qualified key a variable in `section` is recorded under: `core.hookspath`,
 * `remote.origin.url`. Section and variable names are lowercased because git compares them
 * case-insensitively; the subsection keeps its case because git does not. */
const qualify = (section: Section, name: string): string =>
  section.subsection === undefined
    ? `${section.name}.${name.toLowerCase()}`
    : `${section.name}.${section.subsection}.${name.toLowerCase()}`;

const namedSection = (
  section: string,
  subsection: string | undefined,
): Section | typeof MALFORMED => {
  const name = section.toLowerCase();
  if (subsection === undefined) {
    return { name };
  }
  const decoded = decodeSubsection(subsection);
  return decoded === MALFORMED ? MALFORMED : { name, subsection: decoded };
};

/** The section a line opens, plus whatever follows the header on that same line — git allows an
 * assignment there, and rejecting the line outright would condemn a valid config as malformed and
 * leave a perfectly good checkout `unverifiable`. */
const parseSection = (
  line: string,
): { rest: string; section: Section } | typeof MALFORMED | undefined => {
  const match = SECTION_PREFIX.exec(line);
  const section = match?.groups?.['section'];
  if (section === undefined) {
    return undefined;
  }
  const rest = trimConfig(line.slice(match?.[0].length ?? 0));
  const named = namedSection(section, match?.groups?.['subsection']);
  return named === MALFORMED ? MALFORMED : { rest, section: named };
};

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
/** Whatever followed a section header on its own line: nothing, a comment, or an assignment that
 * belongs to the section just opened. */
const consumeInline = (
  found: Map<string, string[]>,
  parsed: { rest: string; section: Section },
  wanted: readonly string[],
): Section | typeof MALFORMED => {
  if (parsed.rest === '' || isSkippable(parsed.rest)) {
    return parsed.section;
  }
  const inline = recordVariable(found, { line: parsed.rest, section: parsed.section, wanted });
  return inline === 'malformed' ? MALFORMED : parsed.section;
};

const consumeLine = (
  found: Map<string, string[]>,
  opts: { line: string; section: Section; wanted: readonly string[] },
): Section | typeof MALFORMED => {
  const parsed = parseSection(opts.line);
  if (parsed === MALFORMED) {
    return MALFORMED;
  }
  if (parsed !== undefined) {
    return consumeInline(found, parsed, opts.wanted);
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
