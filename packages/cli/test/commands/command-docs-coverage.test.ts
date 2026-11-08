import { describe, expect, it } from 'vitest';
import { buildProgram } from '../../src/main.ts';
import { readFile } from 'node:fs/promises';
import { testContext } from '../helpers/context.ts';

// Two references describe the CLI's options: the skill's `--json` contract and the human one. Both
// are written by hand, and nothing tied them to the options the parser registers, so `edit
// --remove`, `--decline` and `--undecline` shipped and went undocumented for several releases.
// The options come from `buildProgram`, the real parser, not from `--help` text.

const REPO = new URL('../../../../', import.meta.url);
const DOCS = ['skills/refs/COMMANDS.md', 'docs/commands.md'] as const;
// Options deliberately left out of a reference, as `<file>: <command> <flag>`, each with the reason.
// Empty: every option is documented in both.
const UNDOCUMENTED = new Set<string>();

type Commands = ReturnType<typeof buildProgram>['commands'];

type Section = { readonly command: string; readonly text: string };

const escaped = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/** The text under the `## \`refs <command>` heading, up to the next second-level heading. */
const sectionOf = (doc: string, command: string): Section | undefined => {
  const heading = new RegExp(`^## \`refs ${escaped(command)}[\` ].*$`, 'mu');
  const start = heading.exec(doc);
  if (start === null) {
    return undefined;
  }
  const [text = ''] = doc.slice(start.index + start[0].length).split(/^## /mu);
  return { command, text };
};

/** Every gap between the registered commands and one reference, as `<file>: <what is missing>`. */
const gapsIn = (file: string, doc: string, commands: Commands): string[] =>
  commands.flatMap((command) => {
    const section = sectionOf(doc, command.name());
    if (section === undefined) {
      return [`${file}: no heading for refs ${command.name()}`];
    }
    return command.options
      .filter((option) => !option.hidden && option.long !== undefined)
      .map((option) => `${file}: ${command.name()} ${String(option.long)}`)
      .filter((gap) => !UNDOCUMENTED.has(gap))
      .filter((gap) => {
        const flag = gap.slice(gap.lastIndexOf(' ') + 1);
        return !new RegExp(String.raw`${escaped(flag)}(?![\w-])`, 'u').test(section.text);
      });
  });

const gaps = async (commands: Commands): Promise<string[]> => {
  const docs = await Promise.all(
    DOCS.map(async (file) => ({ file, text: await readFile(new URL(file, REPO), 'utf8') })),
  );
  return docs.flatMap(({ file, text }) => gapsIn(file, text, commands));
};

const registered = (): Commands => buildProgram(testContext().ctx).commands;

describe('the command references', () => {
  it('document every registered command and option', async () => {
    expect.hasAssertions();
    expect(registered().length).toBeGreaterThan(0);
    await expect(gaps(registered())).resolves.toStrictEqual([]);
  });

  it('would name an option the parser gains', async () => {
    expect.hasAssertions();
    const commands = registered();
    commands
      .find((command) => command.name() === 'edit')
      ?.option('--not-documented-anywhere', 'a flag no reference mentions');
    await expect(gaps(commands)).resolves.toStrictEqual(
      DOCS.map((file) => `${file}: edit --not-documented-anywhere`),
    );
  });
});
