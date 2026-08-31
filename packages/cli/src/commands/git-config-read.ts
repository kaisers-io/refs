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
// It deliberately does NOT implement `include`/`includeIf`. Both values are written into the local
// config by the clone that created the checkout, so they are expected to be physically present —
// and git itself disables includes when a specific config scope is selected, which is what the
// existing `git config --local` marker check already relied on.
//
// Every value seen is returned, not the last one, so the caller can fail closed on a duplicate
// rather than guess at first-versus-last precedence.

const SECTION_LINE = /^\[\s*(?<section>[\w.-]+)\s*(?:"(?<subsection>(?:[^"\\]|\\.)*)")?\s*\]$/u;
const VARIABLE_LINE = /^(?<name>[A-Za-z][\w-]*)\s*(?:=\s*(?<value>.*))?$/u;
// eslint-disable-next-line id-length -- keys are the literal escape characters git defines (b/n/t)
const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', b: '\b', n: '\n', t: '\t' };
const LAST = -1;

/** Joins lines ending in a backslash with the line that follows, which git treats as one logical
 * line. Done before anything else, so a continued value cannot be mistaken for two statements. */
const joinContinuations = (text: string): string[] => {
  const joined: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/u, '');
    const previous = joined.at(LAST);
    if (previous !== undefined && previous.endsWith('\\')) {
      joined[joined.length - 1] = previous.slice(0, LAST) + line;
    } else {
      joined.push(line);
    }
  }
  return joined;
};

/** Strips comments and resolves escapes in one pass, because whether a `#` starts a comment depends
 * on whether it is inside quotes — which a separate comment-stripping step could not know. */
// A backslash escapes the next character; git defines `\"`, `\\`, `\n`, `\t` and `\b`, and anything
// else stands for itself.
const unescape = (next: string | undefined): string =>
  next === undefined ? '' : (ESCAPES[next] ?? next);

// eslint-disable-next-line max-statements -- one pass over the characters, where each branch depends on the quoting state the others maintain; splitting it would need that state threaded through helpers and read worse
const decodeValue = (raw: string): string => {
  let out = '';
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '\\') {
      index += 1;
      out += unescape(raw[index]);
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && (char === '#' || char === ';')) {
      return out.trim();
    } else {
      out += char;
    }
  }
  return out.trim();
};

type Section = { name: string; subsection?: string };

/** The fully-qualified key a variable in `section` is recorded under: `core.hookspath`,
 * `remote.origin.url`. Section and variable names are lowercased because git compares them
 * case-insensitively; the subsection keeps its case because git does not. */
const qualify = (section: Section, name: string): string =>
  section.subsection === undefined
    ? `${section.name}.${name.toLowerCase()}`
    : `${section.name}.${section.subsection}.${name.toLowerCase()}`;

const parseSection = (line: string): Section | undefined => {
  const match = SECTION_LINE.exec(line);
  if (match?.groups === undefined) {
    return undefined;
  }
  const { section, subsection } = match.groups;
  if (section === undefined) {
    return undefined;
  }
  return {
    name: section.toLowerCase(),
    ...(subsection === undefined ? {} : { subsection: decodeValue(`"${subsection}"`) }),
  };
};

const isSkippable = (line: string): boolean =>
  line === '' || line.startsWith('#') || line.startsWith(';');

/** Records one variable line under the section currently in effect, if it is one of the wanted keys.
 *
 * A bare `name` with no `=` is git's boolean true; it is recorded as an empty string, which no
 * caller here accepts as a usable value. */
const recordVariable = (
  found: Map<string, string[]>,
  opts: { line: string; section: Section; wanted: readonly string[] },
): void => {
  const { line, section, wanted } = opts;
  const variable = VARIABLE_LINE.exec(line);
  const name = variable?.groups?.['name'];
  if (name === undefined) {
    return;
  }
  const key = qualify(section, name);
  if (!wanted.includes(key)) {
    return;
  }
  found.set(key, [...(found.get(key) ?? []), decodeValue(variable?.groups?.['value'] ?? '')]);
};

// Stands in for "no section has been opened yet". A variable before the first section header is not
// valid git config, and this name can never qualify into a wanted key, so such lines are ignored
// without needing a nullable to carry that state.
const NO_SECTION: Section = { name: '' };

/** Every value in `text` for each requested key, in file order. A key with no entry was not present;
 * a key with more than one was set more than once, which callers treat as reason to fail closed. */
const readGitConfigValues = (
  text: string,
  wanted: readonly string[],
): ReadonlyMap<string, string[]> => {
  const found = new Map<string, string[]>();
  let section = NO_SECTION;
  for (const line of joinContinuations(text)) {
    const trimmed = line.trim();
    const parsed = isSkippable(trimmed) ? undefined : parseSection(trimmed);
    if (parsed !== undefined) {
      section = parsed;
    } else if (!isSkippable(trimmed)) {
      recordVariable(found, { line: trimmed, section, wanted });
    }
  }
  return found;
};

export { readGitConfigValues };
