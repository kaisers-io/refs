// Only grade text here. In particular, never execute the deliberately hostile command artifacts.
import { commandPattern, repairPatterns } from './command-patterns.mjs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { strictEqual, throws } from 'node:assert/strict';
import { grade } from './graders.mjs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tmpdir } from 'node:os';

// This CI job deliberately has no installed dependencies. Support only the literal fields
// these cases use and reject unknown syntax/options instead of silently changing their meaning.
const readBlock = (block) => {
  const fields = block
    .split('\n')
    .slice(1)
    .filter((line) => line.trim() && !line.trimStart().startsWith('#'));
  strictEqual(
    fields.every((line) => /^    (?:type|pattern|match|target): /u.test(line)),
    true,
    'unsupported grader field',
  );
  strictEqual(
    fields.some((line) => line === '    type: regex'),
    true,
    'command controls require type: regex',
  );
  strictEqual(
    new Set(fields.map((line) => line.split(':')[0])).size,
    fields.length,
    'duplicate grader field',
  );
  const pattern = block.match(/^    pattern: '(?<value>.*)'$/mu)?.groups.value;
  strictEqual(typeof pattern, 'string', 'command controls require a literal one-line pattern');
  strictEqual(pattern.replaceAll("''", '').includes("'"), false, 'unescaped YAML quote');
  return { fields, pattern };
};
const readTarget = (target) => {
  if (target === undefined || target === 'trace') {
    return target;
  }
  const path = target.match(/^\{ source: file, path: (?<value>[^ }]+) \}$/u)?.groups.value;
  strictEqual(typeof path, 'string', 'unsupported grader target');
  return { path, source: 'file' };
};
const readCommandGraders = (text) =>
  text
    .split(/^  - name: /mu)
    .slice(1)
    .map((block) => {
      const { fields, pattern } = readBlock(block);
      const match = fields
        .find((line) => line.startsWith('    match: '))
        ?.slice('    match: '.length);
      strictEqual(
        match === undefined || match === 'not_contains',
        true,
        'unsupported match option',
      );
      return {
        match,
        name: block.split('\n')[0],
        pattern: pattern.replaceAll("''", "'"),
        target: readTarget(
          fields.find((line) => line.startsWith('    target: '))?.slice('    target: '.length),
        ),
        type: 'regex',
      };
    });
const load = async (name) => ({
  graders: readCommandGraders(
    await readFile(new URL(`../../evals/${name}/case.yaml`, import.meta.url), 'utf8'),
  ),
});

const outcome = async (grader, command) => {
  const cwd = await mkdtemp(join(tmpdir(), 'command-grader-'));
  try {
    await writeFile(join(cwd, grader.target.path), command);
    const result = await grade(grader, { cwd, lastMessage: command });
    return result.passed;
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
};
const pathCommand =
  "refs edit 'local/fixtures/toolkit' --package='@toolkit/retry' path 'packages/retry-policy' --json";
const declineCommand =
  "refs edit --package='@toolkit/c$(id)' --decline --path='packages/a b' 'local/fixtures/toolkit'";

test('the dependency-free reader rejects changed grader semantics', () => {
  const valid =
    "  - name: g\n    type: regex\n    pattern: 'x'\n    target: { source: file, path: answer.txt }\n";
  strictEqual(readCommandGraders(valid)[0].pattern, 'x');
  for (const invalid of [
    valid.replace('type: regex', 'type: tool_used'),
    `${valid}    flags: i\n`,
    `${valid}    match: equals\n`,
    `${valid}    tool: Bash\n`,
    valid.replace('source: file', 'source: unknown'),
    `${valid}    type: regex\n`,
  ]) {
    throws(() => readCommandGraders(invalid));
  }
});

test('both hosts use the generated exact repair grammars', async () => {
  const definitions = await Promise.all(
    ['drift-repairs', 'quoted-repair'].map((name) => load(name)),
  );
  for (const definition of definitions) {
    for (const grader of definition.graders.filter((entry) => repairPatterns[entry.name])) {
      strictEqual(grader.type, 'regex');
      strictEqual(grader.pattern, repairPatterns[grader.name]);
      strictEqual(grader.target.source, 'file');
      const paths = {
        'decline-command-is-quoted': 'decline-command.txt',
        'path-edit-for-the-relocated-package': 'relocation-command.txt',
        'removal-for-the-missing-package': 'removal-command.txt',
      };
      strictEqual(grader.target.path, paths[grader.name]);
    }
  }
});

test('path repair accepts option movement but rejects wrong argv and prose', async () => {
  const definition = await load('drift-repairs');
  const grader = definition.graders.find(
    ({ name }) => name === 'path-edit-for-the-relocated-package',
  );
  const good = [
    pathCommand,
    'refs edit --package @toolkit/retry toolkit path packages/retry-policy',
    'refs edit toolkit path --json packages/retry-policy --package="@toolkit/retry"\n',
  ];
  const bad = [
    "refs edit --package='@toolkit/retry' path 'packages/retry-policy' 'local/fixtures/toolkit'",
    pathCommand.replace('local/fixtures/toolkit', 'wrong'),
    pathCommand.replace('packages/retry-policy', 'packages/wrong'),
    pathCommand.replace('@toolkit/retry', '@toolkit/slugify'),
    `${pathCommand} extra`,
    `${pathCommand} --json`,
    `${pathCommand} --package='@toolkit/retry'`,
    `${pathCommand}\n  touch /tmp/this-command-was-not-run`,
    `# ${pathCommand}`,
    `Run ${pathCommand}`,
    `\`${pathCommand}\``,
    pathCommand.replace('path ', ''),
    '',
  ];
  await Promise.all(
    good.map(async (command) => {
      strictEqual(await outcome(grader, command), true, command);
    }),
  );
  await Promise.all(
    bad.map(async (command) => {
      strictEqual(await outcome(grader, command), false, command);
    }),
  );
});

test('decline repair rejects indented second commands and shell programs', async () => {
  const definition = await load('quoted-repair');
  const grader = definition.graders.find(({ name }) => name === 'decline-command-is-quoted');
  const lineGrader = definition.graders.find(({ name }) => name === 'one-command-only');
  const extraLine = `${declineCommand}\n  touch /tmp/this-command-was-not-run\n`;
  strictEqual(await outcome(lineGrader, extraLine), false);
  await Promise.all(
    ['\n', '\r\n', '\n \t\n', ''].map(async (suffix) => {
      strictEqual(await outcome(grader, declineCommand + suffix), true);
    }),
  );
  const bad = [
    extraLine,
    `${declineCommand}; true`,
    `${declineCommand} && true`,
    `${declineCommand} | cat`,
    `${declineCommand} > output`,
    `${declineCommand} # comment`,
    `${declineCommand} extra`,
    `${declineCommand} --decline`,
    `# ${declineCommand}`,
    `Run ${declineCommand}`,
    declineCommand.replace("'@toolkit/c$(id)'", '"@toolkit/c$(id)"'),
    declineCommand.replace("'packages/a b'", 'packages/a b'),
    declineCommand.replace("'@toolkit/c$(id)'", "'@toolkit/c'$(id)"),
    declineCommand.replace('local/fixtures/toolkit', 'wrong'),
  ];
  await Promise.all(
    bad.map(async (command) => {
      strictEqual(await outcome(grader, command), false, command);
    }),
  );
});

test('literal grammar supports spaces, substitutions as data and embedded single quotes', () => {
  const pattern = new RegExp(
    commandPattern(
      [["a'b"]],
      [
        ['--package', 'x$(id)'],
        ['--path', 'a b'],
      ],
    ),
    'u',
  );
  const good = [
    String.raw`refs edit 'a'\''b' --package='x$(id)' --path='a b'`,
    String.raw`refs edit --package="x\$(id)" --path="a b" "a'b"`,
    String.raw`refs edit --package=x\$\(id\) --path=a\ b a\'b`,
    `refs edit 'a'"'"'b' --path='a b' --package='x$(id)'`,
  ];
  for (const command of good) {
    strictEqual(pattern.test(command), true, command);
  }
  strictEqual(pattern.test(`refs edit "a'b" --package="x$(id)" --path='a b'`), false);
});
