// Generate a deliberately restricted, non-executing shell grammar shared by both eval hosts.
// Claude's documented grader API has no script/custom grader: commit the generated regex in YAML.
// This accepts literal words in conventional bare, escaped, single- or double-quoted forms, not
// arbitrary shell programs. Positional order is fixed; known options can move between positionals.
// No substitutions, comments, redirections, extra argv, or additional commands are accepted.

const SPACE = String.raw`[ \t]+`;
const escapeRegex = (text) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
const literalWord = (text) => {
  const single = `'${text.replaceAll("'", String.raw`'\''`)}'`;
  const double = `"${text.replaceAll(/["\\$`]/gu, String.raw`\$&`)}"`;
  const escaped = text.replaceAll(/[^a-zA-Z0-9_@%+=:,./-]/gu, String.raw`\$&`);
  const alternate = single.replaceAll(String.raw`'\''`, `'"'"'`);
  return `(?:${[...new Set([single, double, escaped, alternate])].map((value) => escapeRegex(value)).join('|')})`;
};

const optionPattern = ([name, value]) =>
  value === true ? name : `${name}(?:=|${SPACE})${literalWord(value)}`;

const commandPattern = (positionals, options) => {
  const known = [...options, ['--json', true]];
  const guards = known.map(
    ([name]) =>
      `(?![\\s\\S]*${SPACE}${name}(?==|[ \\t\\r\\n]|$)[\\s\\S]*${SPACE}${name}(?==|[ \\t\\r\\n]|$))`,
  );
  const required = options.map(
    (option) => `(?=[\\s\\S]*${SPACE}${optionPattern(option)}(?:[ \\t\\r\\n]|$))`,
  );
  const gap = `(?:${SPACE}(?:${known.map((value) => optionPattern(value)).join('|')}))*`;
  const args = positionals.map(
    (values) => `${SPACE}(?:${values.map((value) => literalWord(value)).join('|')})${gap}`,
  );
  return `^[ \\t]*refs${SPACE}edit${guards.join('')}${required.join('')}${gap}${args.join('')}[ \\t]*(?:\\r?\\n[ \\t]*)*$(?![\\s\\S])`;
};

const REF = ['local/fixtures/toolkit', 'toolkit'];
const repairPatterns = {
  'decline-command-is-quoted': commandPattern(
    [REF],
    [
      ['--package', '@toolkit/c$(id)'],
      ['--decline', true],
      ['--path', 'packages/a b'],
    ],
  ),
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
};

export { commandPattern, repairPatterns };
