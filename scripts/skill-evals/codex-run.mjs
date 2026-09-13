// Runs one eval case once under `codex exec`, in the same layout the Claude harness gives a run: a
// throwaway HOME, a working directory inside it, and the case's scaffold run there first.

import { cp, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { commandOf } from './graders.mjs';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

const MS_PER_SECOND = 1000;
const DEFAULT_TIMEOUT_SECONDS = 300;

// Only what a run needs. The operator's own environment stays out, as it does under Claude.
const childEnv = (home, extra) => ({
  HOME: home,
  LANG: process.env.LANG ?? 'C.UTF-8',
  PATH: process.env.PATH,
  ...extra,
});

const execWithTimeout = async (args, options, timeoutMs) => {
  const child = spawn('codex', args, { ...options, detached: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    // Kill the whole process group, so no command the agent started outlives the run.
    process.kill(-child.pid, 'SIGKILL');
  }, timeoutMs);
  const [code] = await once(child, 'exit');
  clearTimeout(timer);
  return { code, timedOut };
};

const scaffold = async (root, testCase, run) => {
  const script = join(root, 'evals', testCase.name, testCase.context.scaffold_script);
  const child = spawn('bash', [script], { cwd: run.cwd, env: childEnv(run.home) });
  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const [code] = await once(child, 'exit');
  return code === 0
    ? undefined
    : `scaffold failed (exit ${code}): ${Buffer.concat(stderr).toString().trim()}`;
};

const codexArgs = (testCase, run, settings) => [
  'exec',
  '--json',
  '--ephemeral',
  '--skip-git-repo-check',
  '--ignore-rules',
  '--ignore-user-config',
  '--sandbox',
  'workspace-write',
  '--cd',
  run.cwd,
  '--add-dir',
  run.home,
  '--model',
  settings.model,
  '-c',
  `model_reasoning_effort=${JSON.stringify(settings.effort)}`,
  '-c',
  `developer_instructions=${JSON.stringify(testCase.execution.append_system_prompt ?? '')}`,
  '--output-last-message',
  join(run.dir, 'last.md'),
  testCase.execution.prompt.replace(/^\/refs\b/u, '$refs'),
];

const collect = async (run, outcome) => {
  const trace = await readFile(join(run.dir, 'events.jsonl'), 'utf8');
  const events = trace
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const items = events
    .filter((event) => event.type === 'item.completed')
    .map((event) => event.item);
  const commands = items
    .filter((item) => item.type === 'command_execution')
    .map((item) => commandOf(item.command));
  const lastMessage = await readFile(join(run.dir, 'last.md'), 'utf8').catch(() => '');
  const usage = events.findLast((event) => event.type === 'turn.completed')?.usage;
  // A turn can fail inside a clean exit, e.g. a model the account cannot use.
  const turnFailed = events.find((event) => event.type === 'turn.failed');
  const failure =
    (outcome.timedOut && 'timed out') ||
    (outcome.code !== 0 && `codex exited ${outcome.code}`) ||
    (turnFailed && `turn failed: ${turnFailed.error?.message}`);
  return { ...run, commands, error: failure || undefined, lastMessage, trace, usage };
};

const runAgent = async (testCase, run, settings) => {
  const stdout = await open(join(run.dir, 'events.jsonl'), 'w');
  const stderr = await open(join(run.dir, 'stderr.txt'), 'w');
  const timeoutMs = (testCase.execution.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS) * MS_PER_SECOND;
  const outcome = await execWithTimeout(
    codexArgs(testCase, run, settings),
    {
      cwd: run.cwd,
      env: childEnv(run.home, { CODEX_HOME: settings.codexHome }),
      stdio: ['ignore', stdout.fd, stderr.fd],
    },
    timeoutMs,
  );
  await Promise.all([stdout.close(), stderr.close()]);
  await writeFile(join(run.dir, 'outcome.json'), JSON.stringify(outcome));
  return collect(run, outcome);
};

/** Prepares the workspace, runs scaffold and agent, and returns what the graders read. */
const runOnce = async (root, testCase, { dir, settings }) => {
  const run = { cwd: join(dir, 'home', 'cwd'), dir, home: join(dir, 'home') };
  await mkdir(run.cwd, { recursive: true });
  await cp(join(root, 'skills', 'refs'), join(run.home, '.agents', 'skills', 'refs'), {
    recursive: true,
  });
  const scaffoldError = await scaffold(root, testCase, run);
  return scaffoldError === undefined
    ? runAgent(testCase, run, settings)
    : { ...run, error: scaffoldError };
};

export { runOnce };
