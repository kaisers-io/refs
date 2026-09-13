// Tests for the grader adapter the Codex eval runner uses.
//
//   node --test scripts/skill-evals/graders.test.mjs
//
// The adapter must grade a Codex run the way `claude plugin eval` grades a Claude run, from the same
// case.yaml. What these pin: the shell wrapper Codex puts around every command is undone before an
// input_match sees it, a grader that cannot read its target fails whatever its `match`, and refs'
// compact JSON output is told apart from the skill docs that describe it.

import { assertSupported, commandOf, grade } from './graders.mjs';
import { collect, execWithTimeout, scaffold } from './codex-run.mjs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { strictEqual, throws } from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { tmpdir } from 'node:os';

const DRY_RUN_MARKER = String.raw`\\"tag_format_candidate\\":(?:\\"|null)`;
const EXECUTABLE = 0o755;
const AT_COMMAND = String.raw`(?:"command":\s*"\s*|[\s;&|(]|\\n)`;

const passes = async (grader, run) => {
  const result = await grade(grader, run);
  return result.passed;
};

const runWith = (overrides) => ({
  commands: [],
  cwd: tmpdir(),
  lastMessage: '',
  trace: '',
  ...overrides,
});

const traceOf = (output) =>
  JSON.stringify({
    item: { aggregated_output: output, type: 'command_execution' },
    type: 'item.completed',
  });

test('commandOf undoes the zsh wrapper, including quotes inside the script', () => {
  strictEqual(commandOf(`/bin/zsh -lc 'refs sync --json'`), 'refs sync --json');
  strictEqual(
    commandOf(`/bin/zsh -lc "refs add \\"file:///x\\" --dry-run --json"`),
    'refs add "file:///x" --dry-run --json',
  );
  strictEqual(
    commandOf(`/bin/zsh -lc 'refs edit --package='"'"'@a/b'"'"' --remove k'`),
    "refs edit --package='@a/b' --remove k",
  );
  strictEqual(commandOf('refs doctor --json'), 'refs doctor --json');
});

test('tool_used matches an unwrapped command at command position, and not a grep for it', async () => {
  const grader = {
    input_match: `${AT_COMMAND}refs add [^;&|]*--proposal`,
    max: 0,
    min: 0,
    name: 'g',
    tool: 'Bash',
    type: 'tool_used',
  };
  const finalized = runWith({
    commands: [commandOf(`/bin/zsh -lc 'refs add --proposal p.json --json'`)],
  });
  const grepped = runWith({
    commands: [commandOf(`/bin/zsh -lc 'grep -n "refs add --proposal" ADD.md'`)],
  });
  strictEqual(await passes(grader, finalized), false);
  strictEqual(await passes(grader, grepped), true);
});

test("the dry-run marker matches refs' output and not the docs that describe it", async () => {
  const caseFile = await readFile(
    new URL('../../evals/add-monorepo/case.yaml', import.meta.url),
    'utf8',
  );
  strictEqual(
    caseFile.includes(`pattern: '${DRY_RUN_MARKER}'`),
    true,
    'add-monorepo uses this marker',
  );
  const grader = { name: 'g', pattern: DRY_RUN_MARKER, target: 'trace', type: 'regex' };
  const docs = await readFile(new URL('../../skills/refs/COMMANDS.md', import.meta.url), 'utf8');
  const readingDocs = runWith({ trace: traceOf(docs) });
  const dryRun = runWith({
    trace: traceOf('{"data":{"key":"k","tag_format_candidate":null},"ok":true}'),
  });
  strictEqual(await passes(grader, readingDocs), false);
  strictEqual(await passes(grader, dryRun), true);
});

test('a missing file fails even a not_contains grader', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'graders-'));
  const grader = {
    match: 'not_contains',
    name: 'g',
    pattern: 'x',
    target: { path: 'absent.json', source: 'file' },
    type: 'regex',
  };
  strictEqual(await passes(grader, runWith({ cwd })), false);
  await writeFile(join(cwd, 'absent.json'), 'y');
  strictEqual(await passes(grader, runWith({ cwd })), true);
});

test('count:N and flags follow the case', async () => {
  const text = '"description": "A"\n"description": "b"\n"description": ""';
  const count = {
    match: 'count:2',
    name: 'g',
    pattern: String.raw`"description"\s*:\s*"[^"\s]`,
    type: 'regex',
  };
  const flagged = { flags: 'im', name: 'g', pattern: '^\\W*yes\\b', type: 'regex' };
  strictEqual(await passes(count, runWith({ lastMessage: text })), true);
  strictEqual(await passes(flagged, runWith({ lastMessage: 'Checked.\n**YES**' })), true);
});

test('a file target may not leave the working directory', async () => {
  const grader = {
    name: 'g',
    pattern: '.',
    target: { path: '../outside', source: 'file' },
    type: 'regex',
  };
  strictEqual(await passes(grader, runWith({})), false);
});

test('an unsupported grader is rejected when the case loads', () => {
  throws(() => assertSupported('c', { name: 'judge', type: 'llm' }), /not supported/u);
  throws(
    () => assertSupported('c', { name: 'read', tool: 'Read', type: 'tool_used' }),
    /not supported/u,
  );
  throws(
    () => assertSupported('c', { name: 'files', target: 'files', type: 'regex' }),
    /not supported/u,
  );
  for (const match of ['equals', 'count:two']) {
    throws(
      () => assertSupported('c', { match, name: 'm', pattern: 'x', type: 'regex' }),
      /not supported/u,
    );
  }
});

test('a truncated event line is reported as a run error, not a crash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'collect-'));
  const complete = JSON.stringify({
    item: { text: 'ok', type: 'agent_message' },
    type: 'item.completed',
  });
  await writeFile(join(dir, 'events.jsonl'), `${complete}\n{"type":"item.comp`);
  const run = await collect({ cwd: dir, dir }, { code: 0, timedOut: false });
  strictEqual(run.error, '1 unreadable event line(s)');
});

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('a timeout kills commands running in a process group of their own', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tree-'));
  const pidFile = join(dir, 'pid');
  // `set -m` gives the background sleep its own process group, as Codex does for its commands.
  const script = `set -m; sleep 30 & echo $! > ${pidFile}; wait`;
  const outcome = await execWithTimeout('bash', ['-c', script], { stderr: [], timeoutMs: 500 });
  const grandchild = Number(await readFile(pidFile, 'utf8'));
  strictEqual(outcome.timedOut, true);
  strictEqual(isAlive(grandchild), false);
});

test('a scaffold that prints a lot does not block the suite', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scaffold-'));
  await mkdir(join(root, 'evals', 'noisy'), { recursive: true });
  const script = join(root, 'evals', 'noisy', 'scaffold.sh');
  await writeFile(script, '#!/usr/bin/env bash\nhead -c 2000000 /dev/zero\n', { mode: EXECUTABLE });
  const run = { cwd: root, home: root };
  const testCase = { context: { scaffold_script: 'scaffold.sh' }, name: 'noisy' };
  strictEqual(await scaffold(root, testCase, run), undefined);
});
