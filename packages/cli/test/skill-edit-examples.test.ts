import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// The skill teaches agents how to write `refs edit` command lines, and an agent copies the shape.
// `refs edit` takes `<ref> [field] [value]` as positionals in that order (commands/edit.ts);
// options may move, positionals may not. An example that puts the field first makes `path` the ref
// query, and the command fails with "no ref matches 'path'" (exit 4).

const SKILL_DIR = fileURLToPath(new URL('../../../skills/refs/', import.meta.url));
const INLINE = /`(?<command>refs edit [^`]+)`/gu;
const BLOCK_LINE = /^(?<command>refs edit .+)$/gmu;
// A shell word: unquoted characters and single-quoted runs, so `--description='a b'` is one.
const TOKEN = /(?:[^\s']|'[^']*')+/gu;
// `refs edit settings <key> <value>` is the other three-positional form, and fine as it is.
const FIRST_POSITIONAL = /<ref>|^settings$/u;
const COMMAND_WORDS = 2;
const FIELD_AND_VALUE = 3;

/** Every `refs edit …` example in the skill, inline or on its own line in a code block. */
const editExamples = async (): Promise<{ command: string; file: string }[]> => {
  const entries = await readdir(SKILL_DIR);
  const files = entries.filter((name) => name.endsWith('.md'));
  const found: { command: string; file: string }[] = [];
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop -- a handful of small files, read once
    const text = await readFile(join(SKILL_DIR, file), 'utf8');
    for (const match of [...text.matchAll(INLINE), ...text.matchAll(BLOCK_LINE)]) {
      found.push({ command: match.groups?.['command'] ?? '', file });
    }
  }
  return found;
};

/** The positional arguments after `refs edit`: every token that is not an option. */
const positionals = (command: string): string[] =>
  (command.match(TOKEN) ?? []).slice(COMMAND_WORDS).filter((token) => !token.startsWith('-'));

const isMisordered = (args: readonly string[]): boolean =>
  args.length >= FIELD_AND_VALUE && !FIRST_POSITIONAL.test(args[0] ?? '');

describe('refs edit examples in the skill', () => {
  it('exist, so this check is not vacuous', async () => {
    expect.hasAssertions();
    const examples = await editExamples();
    expect(examples.length).toBeGreaterThan(FIELD_AND_VALUE);
  });

  it('name the ref first whenever they also name a field and a value', async () => {
    expect.hasAssertions();
    const examples = await editExamples();
    const misordered = examples.filter(({ command }) => isMisordered(positionals(command)));
    expect(misordered).toStrictEqual([]);
  });
});
