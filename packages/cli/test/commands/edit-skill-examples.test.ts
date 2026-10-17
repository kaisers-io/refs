import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import type { Command } from 'commander';
import { buildProgram } from '../../src/main.ts';
import { join } from 'node:path';
import { testContext } from '../helpers/context.ts';

// The skill teaches agents the shape of a `refs edit` line, and an agent copies the shape. Options
// may move but positionals keep their order, so an example that writes the ref last makes `path`
// the ref query and the command exits 4 with "no ref matches 'path'" (#218). Each example is
// parsed by the CLI's own `edit` command, so the grammar checked is the one refs runs with.

const SKILL_DIR = new URL('../../../../skills/refs/', import.meta.url);
const INLINE = /`(?<command>refs edit [^`\n]+)`/gu;
const BLOCK_LINE = /^(?<command>refs edit .+)$/gmu;
// A shell word: unquoted characters and quoted runs, so `--description='a b'` stays one word.
const WORD = /(?:[^\s'"]|'[^']*'|"[^"]*")+/gu;
const QUOTED = /'(?<single>[^']*)'|"(?<double>[^"]*)"/gu;
// A synopsis marks optional parts with brackets: `[--package <name>]`.
const OPTIONAL_MARK = /^\[|\]$/gu;
const REF_FIRST = new Set(['<ref>', 'settings']);
const MIN_EXAMPLES = 5;

type Example = {
  readonly command: string;
  readonly file: string;
};

/** Every `refs edit …` example in the skill's Markdown, inline or alone on a code-block line. */
const skillExamples = async (): Promise<Example[]> => {
  const entries = await readdir(SKILL_DIR, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md'));
  const texts = await Promise.all(
    files.map(async (entry) => ({
      file: entry.name,
      text: await readFile(join(entry.parentPath, entry.name), 'utf8'),
    })),
  );
  return texts.flatMap(({ file, text }) =>
    [...text.matchAll(INLINE), ...text.matchAll(BLOCK_LINE)].map((match) => ({
      command: match.groups?.['command'] ?? '',
      file,
    })),
  );
};

const argvOf = (command: string): string[] =>
  (command.match(WORD) ?? []).map((word) =>
    word.replaceAll(QUOTED, '$<single>$<double>').replaceAll(OPTIONAL_MARK, ''),
  );

/** The first positional the real `edit` command sees for this line. */
const firstPositional = async (command: string): Promise<unknown> => {
  const program = buildProgram(testContext().ctx);
  const edit = program.commands.find((cmd) => cmd.name() === 'edit') as Command;
  let first: unknown = undefined;
  edit.action((parsed: unknown) => {
    first = parsed;
  });
  await program.parseAsync(['node', ...argvOf(command)]);
  return first;
};

const misordered = async (examples: readonly Example[]): Promise<Example[]> => {
  const firsts = await Promise.all(examples.map(({ command }) => firstPositional(command)));
  return examples.filter((_example, index) => !REF_FIRST.has(String(firsts[index])));
};

describe('refs edit examples in the skill', () => {
  it('are found, so the ordering check below is not vacuous', async () => {
    expect.hasAssertions();
    const examples = await skillExamples();
    expect(examples.length).toBeGreaterThanOrEqual(MIN_EXAMPLES);
  });

  it('all name the ref as the first positional', async () => {
    expect.hasAssertions();
    await expect(misordered(await skillExamples())).resolves.toStrictEqual([]);
  });

  it('would catch the ref-last form the skill once taught', async () => {
    expect.hasAssertions();
    const bad = { command: "refs edit --package='<name>' path '<new-path>' '<ref>'", file: 'x' };
    const good = { command: "refs edit --package '<name>' '<ref>' path '<new-path>'", file: 'y' };
    await expect(misordered([bad, good])).resolves.toStrictEqual([bad]);
  });
});
