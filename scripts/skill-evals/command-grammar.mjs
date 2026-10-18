// The exact command grammar the repair graders in evals/drift-repairs and evals/quoted-repair use.
//
//   node scripts/skill-evals/command-grammar.mjs --check   # CI: case files match this module
//   node scripts/skill-evals/command-grammar.mjs --write   # regenerate their `pattern:` lines
//
// Both eval runners (Codex through graders.mjs, Claude through `claude plugin eval`) only have
// regex graders, so the grammar is compiled to a regex and committed in the case file. Writing it
// by hand is how #219 happened: a pattern that checked for the parts of a command but not their
// order. Here the pattern is built from the argv itself:
//
// - `refs edit`, then the positionals in order. A known option may sit before, between or after
//   them; refs (commander) accepts that. `--json` is always allowed.
// - Every option at most once. A second `--package` would edit a different package than the one
//   checked, because the last one wins. An option refs does not know, or one the repair does not
//   use (`--remove` on a path edit), fails: refs would exit 2, or do something else.
// - Each value as one literal shell word: single-quoted (a `'` inside written `'\''` or
//   `'"'"'`), double-quoted with `\`, `"`, `$` and backquote escaped, or bare with every
//   metacharacter backslash-escaped. So `$(id)` and a space are data, never syntax.
// - Nothing after the last word but whitespace and blank lines: no comment, no `;`, `&&`, `|` or
//   redirection, no second command on a later line, indented or not.
//
// It is a deliberately small grammar, not a shell parser: unusual but equivalent spellings (a
// value quoted in two halves, `$'…'`) fail. The patterns use only syntax JavaScript and Python
// regexes share; `(?![\s\S])` is end of input in both.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SP = String.raw`[ \t]+`;
const END_OF_WORD = String.raw`(?=[ \t\r\n]|$)`;
const SAFE_BARE = /[\w@%+=:,./-]/u;

const escapeRegex = (text) => text.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);

/** Every spelling of `text` as one shell word that this grammar accepts. */
const spellings = (text) => {
  const single = `'${text.replaceAll("'", String.raw`'\''`)}'`;
  const singleAlt = `'${text.replaceAll("'", `'"'"'`)}'`;
  const double = `"${text.replaceAll(/["$\\`]/gu, String.raw`\$&`)}"`;
  const bare = [...text].map((char) => (SAFE_BARE.test(char) ? char : `\\${char}`)).join('');
  return [...new Set([single, singleAlt, double, bare])];
};

const wordPattern = (alternatives) =>
  `(?:${alternatives.flatMap((text) => spellings(text)).map((word) => escapeRegex(word)).join('|')})`;

const optionPattern = ([name, value]) =>
  value === true ? escapeRegex(name) : `${escapeRegex(name)}(?:=|${SP})${wordPattern([value])}`;

const occurs = (name) => `${SP}${escapeRegex(name)}(?==|[ \\t\\r\\n]|$)`;

/**
 * The regex source for `refs edit <positionals…>` with `options`.
 * @param {string[][]} positionals each entry: the accepted values for that position, in order
 * @param {[string, string | true][]} options each required; `true` for a flag without a value
 */
const commandPattern = (positionals, options) => {
  const known = [...options, ['--json', true]];
  const once = known.map(([name]) => `(?![\\s\\S]*${occurs(name)}[\\s\\S]*${occurs(name)})`);
  const required = options.map((option) => `(?=[\\s\\S]*${SP}${optionPattern(option)}${END_OF_WORD})`);
  const gap = `(?:${SP}(?:${known.map((option) => optionPattern(option)).join('|')})${END_OF_WORD})*`;
  const words = positionals.map((values) => `${SP}${wordPattern(values)}${END_OF_WORD}${gap}`);
  return `^\\s*refs${SP}edit${once.join('')}${required.join('')}${gap}${words.join('')}[ \\t]*(?:\\r?\\n[ \\t]*)*(?![\\s\\S])`;
};

const REF = ['local/fixtures/toolkit', 'toolkit'];

/** The graders built from this grammar, by case and grader name. */
const GRAMMARS = {
  'drift-repairs': {
    'path-edit-for-the-relocated-package': commandPattern(
      [REF, ['path'], ['packages/retry-policy']],
      [['--package', '@toolkit/retry']],
    ),
    'removal-for-the-missing-package': commandPattern(
      [REF],
      [
        ['--package', '@toolkit/slugify'],
        ['--remove', true],
      ],
    ),
  },
  'quoted-repair': {
    'decline-command-is-quoted': commandPattern(
      [REF],
      [
        ['--package', '@toolkit/c$(id)'],
        ['--decline', true],
        ['--path', 'packages/a b'],
      ],
    ),
  },
};

const caseFile = (caseName) =>
  fileURLToPath(new URL(`../../evals/${caseName}/case.yaml`, import.meta.url));

// The `pattern:` line of grader `name`: the first one after its `- name:` line.
const NOT_FOUND = -1;
const patternLine = (lines, name) => {
  const start = lines.indexOf(`  - name: ${name}`);
  const offset = lines.slice(start + 1).findIndex((line) => line.startsWith('    pattern: '));
  return start === NOT_FOUND || offset === NOT_FOUND ? NOT_FOUND : start + 1 + offset;
};

const caseLines = async (caseName) => {
  const text = await readFile(caseFile(caseName), 'utf8');
  return text.split('\n');
};

const yamlLine = (pattern) => `    pattern: '${pattern.replaceAll("'", "''")}'`;

/** Case files whose committed pattern differs from this module's, as `case/grader` names. */
const staleGraders = async () => {
  const stale = await Promise.all(
    Object.entries(GRAMMARS).map(async ([caseName, graders]) => {
      const lines = await caseLines(caseName);
      return Object.entries(graders)
        .filter(([name, pattern]) => lines[patternLine(lines, name)] !== yamlLine(pattern))
        .map(([name]) => `${caseName}/${name}`);
    }),
  );
  return stale.flat();
};

const writeGraders = async () => {
  await Promise.all(
    Object.entries(GRAMMARS).map(async ([caseName, graders]) => {
      const lines = await caseLines(caseName);
      for (const [name, pattern] of Object.entries(graders)) {
        const index = patternLine(lines, name);
        if (index === NOT_FOUND) {
          throw new Error(`${caseName}: no grader ${name} with a pattern line`);
        }
        lines[index] = yamlLine(pattern);
      }
      await writeFile(caseFile(caseName), lines.join('\n'));
    }),
  );
};

const main = async (mode) => {
  if (mode === '--write') {
    await writeGraders();
    return 0;
  }
  const stale = await staleGraders();
  for (const name of stale) {
    process.stderr.write(`${name}: pattern differs from command-grammar.mjs; run --write\n`);
  }
  return stale.length === 0 ? 0 : 1;
};

const [, script, mode] = process.argv;
if (script === import.meta.filename) {
  process.exitCode = await main(mode);
}

export { GRAMMARS, commandPattern, spellings, staleGraders };
