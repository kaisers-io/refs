// Pilot orchestrator: expand the cell grid, run each cell headless (isolated),
// score it with a blinded cross-family judge, and append one JSON line per run.
// `expandCells` is pure and unit-tested; `main()` is thin real-subprocess glue.

import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeJudge } from './lib/judge.mjs';
import { runCell } from './lib/runner.mjs';
import { scoreAnswer } from './lib/score.mjs';
import { spawnExec } from './lib/exec.mjs';

const CONDITIONS_DIR = new URL('conditions/', import.meta.url);
const TASKS_DIR = new URL('tasks/', import.meta.url);
const RESULTS_DIR = new URL('results/', import.meta.url);
const REFS_BIN = new URL('../../packages/cli/bin/refs.mjs', import.meta.url);

const RUNGS = ['naive', 'discipline', 'full'];
const MODELS = ['claude', 'codex'];
const RUNG_FILE = { discipline: 'discipline.md', full: 'full.md', naive: 'naive.md' };
// Cross-family: each model's answers are judged by the OTHER model.
const JUDGE_OF = { claude: 'codex', codex: 'claude' };
const DEFAULT_REPEATS = 3;
const NOT_FOUND = -1;
const NEXT = 1;

const range = (count) => Array.from({ length: count }, (_value, index) => index);

// Repeat is the OUTERMOST dimension (spreads a cell's repeats far apart in time);
// rung is the innermost (adjacent cells differ in rung — defeats warm-cache/drift).
// eslint-disable-next-line max-params -- the four grid axes are the natural signature
const expandCells = (tasks, models, rungs, repeats) =>
  range(repeats).flatMap((repeat) =>
    tasks.flatMap((task) =>
      models.flatMap((model) => rungs.map((rung) => ({ model, repeat, rung, task }))),
    ),
  );

const loadPreambles = async () => {
  const entries = await Promise.all(
    RUNGS.map(async (rung) => {
      const text = await readFile(new URL(RUNG_FILE[rung], CONDITIONS_DIR), 'utf8');
      return [rung, text];
    }),
  );
  return Object.fromEntries(entries);
};

const loadTasks = async () => {
  const files = await readdir(TASKS_DIR);
  const names = files.filter((name) => name.endsWith('.json'));
  return Promise.all(
    names.map(async (name) => {
      const text = await readFile(new URL(name, TASKS_DIR), 'utf8');
      return JSON.parse(text);
    }),
  );
};

const resolveCheckout = async (ref) => {
  const { stdout } = await spawnExec(
    'node',
    [fileURLToPath(REFS_BIN), 'resolve', ref, '--json'],
    {},
  );
  return JSON.parse(stdout).data.local_path;
};

const resolveCheckouts = async (tasks) => {
  const refs = [...new Set(tasks.map((task) => task.ref))];
  const entries = await Promise.all(refs.map(async (ref) => [ref, await resolveCheckout(ref)]));
  return Object.fromEntries(entries);
};

const parseRepeats = (argv) => {
  const index = argv.indexOf('--repeats');
  if (index === NOT_FOUND) {
    return DEFAULT_REPEATS;
  }
  return Number(argv[index + NEXT]);
};

const runOne = async (cell, preambles, checkouts) => {
  const { model, repeat, rung, task } = cell;
  const cwd = checkouts[task.ref];
  const result = await runCell(spawnExec, {
    cwd,
    model,
    preamble: preambles[rung],
    question: task.question,
  });
  const judge = makeJudge(spawnExec, JUDGE_OF[model], cwd);
  const score = await scoreAnswer(task, result.answer, judge);
  return {
    answer: result.answer,
    model,
    repeat,
    rung,
    score,
    task_id: task.id,
    telemetry: result.telemetry,
    wall_ms: result.wall_ms,
  };
};

const errorRecord = (cell, error) => ({
  error: String(error),
  model: cell.model,
  repeat: cell.repeat,
  rung: cell.rung,
  task_id: cell.task.id,
});

// One failing cell must not discard the whole run: record the error and continue.
const settleCell = async (cell, preambles, checkouts) => {
  try {
    return await runOne(cell, preambles, checkouts);
  } catch (error) {
    return errorRecord(cell, error);
  }
};

const runAll = async ({ cells, checkouts, outPath, preambles }) => {
  for (const cell of cells) {
    // eslint-disable-next-line no-await-in-loop -- cells run sequentially by design (interleaved, cache-controlled)
    const record = await settleCell(cell, preambles, checkouts);
    // eslint-disable-next-line no-await-in-loop -- append in order as each run completes
    await appendFile(outPath, `${JSON.stringify(record)}\n`);
    process.stdout.write(
      `${record.model}/${record.rung} ${record.task_id} pass=${record.score?.pass ?? 'ERROR'}\n`,
    );
  }
};

const main = async () => {
  const repeats = parseRepeats(process.argv);
  const [preambles, tasks] = await Promise.all([loadPreambles(), loadTasks()]);
  const checkouts = await resolveCheckouts(tasks);
  await mkdir(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const outPath = new URL(`${stamp}.jsonl`, RESULTS_DIR);
  const cells = expandCells(tasks, MODELS, RUNGS, repeats);
  await runAll({ cells, checkouts, outPath, preambles });
};

const [, entryPath] = process.argv;
if (entryPath === import.meta.filename) {
  await main();
}

export { expandCells };
