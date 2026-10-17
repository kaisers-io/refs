// A documentation grammar check, not a shell parser or executor. Examples use placeholders.
import { deepStrictEqual, ok } from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

const skill = new URL('../../skills/refs/', import.meta.url);
const examples = (text) =>
  [...text.matchAll(/`(?<command>refs edit [^`\n]+)`|^(?<line>refs edit .+)$/gmu)].map(
    ({ groups }) => groups.command ?? groups.line,
  );
const valueOptions = new Set(['--package', '--path', '--description']);
const COMMAND_WORDS = 2;
const MIN_EXAMPLES = 3;
const positionals = (command) => {
  const words = command.match(/(?:[^\s'"[\]]+|'[^']*'|"[^"]*")+/gu).slice(COMMAND_WORDS);
  const result = [];
  let skipValue = false;
  for (const word of words) {
    if (skipValue) {
      skipValue = false;
    } else if (valueOptions.has(word)) {
      skipValue = true;
    } else if (!word.startsWith('--')) {
      result.push(word.replaceAll(/^['"]|['"]$/gu, ''));
    }
  }
  return result;
};
const valid = (command) => ['<ref>', 'settings'].includes(positionals(command)[0]);

test('every skill Markdown edit example keeps the reference before field and value', async () => {
  const entries = await readdir(skill, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(entry.parentPath, entry.name));
  const found = await Promise.all(
    files.map(async (file) => ({
      commands: examples(await readFile(file, 'utf8')),
      file,
    })),
  );
  ok(
    found.flatMap(({ commands }) => commands).length > MIN_EXAMPLES,
    'the scan must find real examples',
  );
  deepStrictEqual(
    found.flatMap(({ file, commands }) =>
      commands.filter((command) => !valid(command)).map((command) => ({ command, file })),
    ),
    [],
  );
});

test('the all-document guard catches field-first examples and handles separate option values', () => {
  const good = [
    "refs edit '<ref>' --package '<name>' path '<new-path>'",
    "refs edit --description='<what it is>' '<ref>'",
    'refs edit settings <key> <value>',
  ];
  deepStrictEqual(
    good.map((command) => valid(command)),
    [true, true, true],
  );
  const bad = "refs edit --package='<name>' path '<new-path>' '<ref>'";
  for (const text of [`Use \`${bad}\` now.`, `\`\`\`sh\n${bad}\n\`\`\``]) {
    deepStrictEqual(
      examples(text).map((command) => valid(command)),
      [false],
    );
  }
});
