// Runs one eval case once under `codex exec`, in the same layout the Claude harness gives a run: a
// throwaway HOME, a working directory inside it, and the case's scaffold run there first.

import { cp, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { commandOf } from './graders.mjs';
import { join } from 'node:path';
import { once } from 'node:events';
import { promisify } from 'node:util';

const MS_PER_SECOND = 1000;
const DEFAULT_TIMEOUT_SECONDS = 300;
const SCAFFOLD_TIMEOUT_MS = 120_000;

// Only what a run needs. The operator's own environment stays out, as it does under Claude.
const childEnv = (home, extra) => ({
  HOME: home,
  LANG: process.env.LANG ?? 'C.UTF-8',
  PATH: process.env.PATH,
  ...extra,
});

// Codex starts the agent's commands in process groups of their own, so killing Codex's group
// leaves them running. On timeout, every descendant is found through `ps` and killed with it.
const descendantsOf = async (root) => {
  const { stdout } = await promisify(execFile)('ps', ['-A', '-o', 'pid=,ppid=']);
  const children = Map.groupBy(
    stdout
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/u).map(Number)),
    ([, parent]) => parent,
  );
  const found = [];
  for (let queue = [root]; queue.length > 0;) {
    const next = (children.get(queue.shift()) ?? []).map(([pid]) => pid);
    found.push(...next);
    queue = [...queue, ...next];
  }
  return found;
};

const killTree = async (pid) => {
  for (const target of [pid, ...(await descendantsOf(pid))]) {
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
};

const execWithTimeout = async (command, args, options) => {
  const child = spawn(command, args, options);
  child.stderr?.on('data', (chunk) => options.stderr.push(chunk));
  let timedOut = false;
  const timer = setTimeout(async () => {
    timedOut = true;
    await killTree(child.pid);
  }, options.timeoutMs);
  const [code] = await once(child, 'exit');
  clearTimeout(timer);
  return { code, timedOut };
};

const scaffold = async (root, testCase, run) => {
  const script = join(root, 'evals', testCase.name, testCase.context.scaffold_script);
  const stderr = [];
  const { code, timedOut } = await execWithTimeout('bash', [script], {
    cwd: run.cwd,
    env: childEnv(run.home),
    // Scaffold output is not read, so it goes nowhere rather than into a pipe that can fill up.
    stderr,
    stdio: ['ignore', 'ignore', 'pipe'],
    timeoutMs: SCAFFOLD_TIMEOUT_MS,
  });
  const detail = timedOut ? 'timed out' : `exit ${code}`;
  return code === 0
    ? undefined
    : `scaffold failed (${detail}): ${Buffer.concat(stderr).toString().trim()}`;
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

// A run killed mid-write can leave a truncated last line. That line is dropped and reported, and
// the rest of the suite carries on.
const parseEvents = (trace) => {
  const lines = trace.split('\n').filter(Boolean);
  const events = lines.flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const unreadable = lines.length - events.length;
  return { events, unreadable: unreadable > 0 && `${unreadable} unreadable event line(s)` };
};

const collect = async (run, outcome) => {
  const trace = await readFile(join(run.dir, 'events.jsonl'), 'utf8').catch(() => '');
  const { events, unreadable } = parseEvents(trace);
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
    (turnFailed && `turn failed: ${turnFailed.error?.message}`) ||
    unreadable;
  return { ...run, commands, error: failure || undefined, lastMessage, trace, usage };
};

const runAgent = async (testCase, run, settings) => {
  const stdout = await open(join(run.dir, 'events.jsonl'), 'w');
  const stderr = await open(join(run.dir, 'stderr.txt'), 'w');
  const outcome = await execWithTimeout('codex', codexArgs(testCase, run, settings), {
    cwd: run.cwd,
    env: childEnv(run.home, { CODEX_HOME: settings.codexHome }),
    stdio: ['ignore', stdout.fd, stderr.fd],
    timeoutMs: (testCase.execution.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS) * MS_PER_SECOND,
  });
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

export { collect, execWithTimeout, runOnce, scaffold };
