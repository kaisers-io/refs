// Decoding one git config value: its escapes, its quoting, and which of its whitespace is layout
// rather than content. Split from `git-config-read.ts`, which is about the file's STRUCTURE; this
// is about a single value inside it.
//
// The distinctions are not pedantry. Git treats `[remote " origin "]` as a subsection distinct from
// `origin`, so trimming quoted space would let a config declaring only the spaced form satisfy a
// check for `origin`. And git's config whitespace is space and horizontal tab alone, where
// JavaScript's `\s` and `String.trim()` also cover unicode spaces — trimming one of those would
// make a value match that git reads differently.

// The only escapes git defines inside a config VALUE. Anything else is a malformed file.
// eslint-disable-next-line id-length -- keys are the literal escape characters git defines (b/n/t)
const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', b: '\b', n: '\n', t: '\t' };
// Inside a SUBSECTION name git recognises only these two; the rest are not escapes there.
const SUBSECTION_ESCAPES: Record<string, string> = { '"': '"', '\\': '\\' };
// Git treats only space and horizontal tab as trimmable config whitespace.
const CONFIG_SPACE = new Set([' ', '\t']);

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

// `String.trim()` would be wrong here for the same reason `\s` is: it strips unicode whitespace,
// which git keeps. Only leading/trailing space and tab are layout.
const CONFIG_SPACE_EDGES = /^[ \t]+|[ \t]+$/gu;

const trimConfig = (line: string): string => line.replace(CONFIG_SPACE_EDGES, '');

export { MALFORMED, decodeSubsection, decodeValue, trimConfig };
export type { Decoded };
