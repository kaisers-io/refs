// Source-access pilot orchestrator: A0 (no source) vs B (refs checkout).
//
// Adapts the Phase-B grid harness (bench/pilot/lib) unchanged — same runCell exec
// seam, same blinded opposite-family judge, same rubric scoring. The ONLY thing that
// distinguishes the two arms is the working directory + preamble handed to the agent:
//   - `refs`      -> cwd is the real dependency checkout; the agent can read + git it.
//   - `no-source` -> cwd is an empty scratch dir; the preamble says there is no source.
// Everything else (model, question, judge, rubric) is held identical, so "source
// availability" is the single manipulated variable.

import { appendFile, mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { makeJudge } from '../pilot/lib/judge.mjs';
import { runCell } from '../pilot/lib/runner.mjs';
import { scoreAnswer } from '../pilot/lib/score.mjs';
import { spawnExec } from '../pilot/lib/exec.mjs';
import { tmpdir } from 'node:os';

const CONDITIONS_DIR = new URL('conditions/', import.meta.url);
const TASKS_DIR = new URL('tasks/', import.meta.url);
const RESULTS_DIR = new URL('results/', import.meta.url);
const REFS_BIN = new URL('../../packages/cli/bin/refs.mjs', import.meta.url);

const ARMS = ['no-source', 'refs'];
const ARM_FILE = { 'no-source': 'no-source.md', refs: 'refs.md' };
const MODELS = ['claude', 'codex'];
// Cross-family: each model's answers are graded by the OTHER model (pilot-grade; the
// stricter design wants a single third family — see issue #16 harness section).
const JUDGE_OF = { claude: 'codex', codex: 'claude' };
const DEFAULT_REPEATS = 3;
const DEFAULT_CONCURRENCY = 4;
const NOT_FOUND = -1;
const NEXT = 1;
const ZERO = 0;
const OK_EXIT = 0;
const DEFAULT_SEED = 1;
const JUDGE_CWD = tmpdir();
const LCG_A = 1_664_525;
const LCG_C = 1_013_904_223;
const LCG_M = 4_294_967_296;

const range = (count) => Array.from({ length: count }, (_value, index) => index);

const makeRng = (seed) => {
  let state = seed;
  return () => {
    state = (LCG_A * state + LCG_C) % LCG_M;
    return state / LCG_M;
  };
};

const shuffle = (items, rng) => {
  const out = [...items];
  for (let index = out.length - NEXT; index > ZERO; index -= NEXT) {
    const swap = Math.floor(rng() * (index + NEXT));
    const held = out[index];
    out[index] = out[swap];
    out[swap] = held;
  }
  return out;
};

// Repeat outermost (spreads a cell's repeats far apart in time); arm innermost
// (adjacent cells differ in arm), mirroring the Phase-B interleaving discipline.
// eslint-disable-next-line max-params -- the four grid axes are the natural signature
const expandCells = (tasks, models, arms, repeats) =>
  range(repeats).flatMap((repeat) =>
    tasks.flatMap((task) =>
      models.flatMap((model) => arms.map((arm) => ({ arm, model, repeat, task }))),
    ),
  );

const loadPreambles = async () => {
  const entries = await Promise.all(
    ARMS.map(async (arm) => {
      const text = await readFile(new URL(ARM_FILE[arm], CONDITIONS_DIR), 'utf8');
      return [arm, text];
    }),
  );
  return Object.fromEntries(entries);
};

const filterTasks = (tasks, only) => {
  if (only.length === ZERO) {
    return tasks;
  }
  return tasks.filter((task) => only.some((frag) => task.id.includes(frag)));
};

const loadTasks = async (only) => {
  const files = await readdir(TASKS_DIR);
  const names = files.filter((name) => name.endsWith('.json'));
  const tasks = await Promise.all(
    names.map(async (name) => JSON.parse(await readFile(new URL(name, TASKS_DIR), 'utf8'))),
  );
  return filterTasks(tasks, only);
};

const resolveCheckout = async (exec, ref) => {
  const { stdout } = await exec('node', [fileURLToPath(REFS_BIN), 'resolve', ref, '--json'], {});
  return JSON.parse(stdout).data.local_path;
};

const headSha = async (exec, path) => {
  const { stdout, code } = await exec('git', ['-C', path, 'rev-parse', 'HEAD'], {});
  if (code === OK_EXIT) {
    return stdout.trim();
  }
  return '';
};

// Per-arm cwd: the real checkout for `refs`, an empty scratch dir for `no-source`.
const armCwd = (arm, checkoutPath, scratchDir) => {
  if (arm === 'refs') {
    return checkoutPath;
  }
  return scratchDir;
};

const runOneCell = async (exec, cell, ctx) => {
  const { arm, model, repeat, task } = cell;
  const cwd = armCwd(arm, ctx.checkoutPath, ctx.scratchDir);
  const started_at = new Date().toISOString();
  const cellSpec = { cwd, model, preamble: ctx.preambles[arm], question: task.question };
  const result = await runCell(exec, cellSpec);
  const judge = makeJudge(exec, JUDGE_OF[model], JUDGE_CWD);
  const score = await scoreAnswer(task, result.answer, judge);
  return {
    answer: result.answer,
    arm,
    change_unit: task.change_unit,
    code: result.code,
    failed: result.failed,
    job_type: task.job_type,
    model,
    pass: score.pass,
    repeat,
    score,
    started_at,
    task_id: task.id,
    telemetry: result.telemetry,
    wall_ms: result.wall_ms,
  };
};

const errorRecord = (cell, error) => ({
  arm: cell.arm,
  error: String(error),
  model: cell.model,
  repeat: cell.repeat,
  task_id: cell.task.id,
});

const settleCell = async (exec, cell, ctx) => {
  try {
    return await runOneCell(exec, cell, ctx);
  } catch (error) {
    return errorRecord(cell, error);
  }
};

const recordLine = (record) =>
  `${record.arm}/${record.model} ${record.task_id} pass=${record.pass ?? 'ERROR'}\n`;

// Bounded-concurrency pool: `concurrency` workers pull cells off a shared cursor.
const runPool = async ({ cells, concurrency, exec, ctx, outPath }) => {
  let cursor = ZERO;
  const worker = async () => {
    while (cursor < cells.length) {
      const cell = cells[cursor];
      cursor += NEXT;
      // eslint-disable-next-line no-await-in-loop -- worker processes its cells in series
      const record = await settleCell(exec, cell, ctx);
      // eslint-disable-next-line no-await-in-loop -- append as each completes (order-independent JSONL)
      await appendFile(outPath, `${JSON.stringify(record)}\n`);
      process.stdout.write(recordLine(record));
    }
  };
  const pool = Math.min(concurrency, cells.length);
  await Promise.all(range(pool).map(() => worker()));
};

const numArg = (argv, flag, fallback) => {
  const index = argv.indexOf(flag);
  if (index === NOT_FOUND) {
    return fallback;
  }
  return Number(argv[index + NEXT]);
};

const listArg = (argv, flag) => {
  const index = argv.indexOf(flag);
  if (index === NOT_FOUND) {
    return [];
  }
  return String(argv[index + NEXT]).split(',');
};

const pickModels = (models) => {
  if (models.length === ZERO) {
    return MODELS;
  }
  return models;
};

const newOutPath = () => {
  const stamp = new Date().toISOString().replaceAll(':', '-');
  return new URL(`${stamp}.jsonl`, RESULTS_DIR);
};

const parseArgs = (argv) => ({
  concurrency: numArg(argv, '--concurrency', DEFAULT_CONCURRENCY),
  models: pickModels(listArg(argv, '--models')),
  only: listArg(argv, '--tasks'),
  repeats: numArg(argv, '--repeats', DEFAULT_REPEATS),
  seed: numArg(argv, '--seed', DEFAULT_SEED),
});

const prepare = async (args) => {
  const [preambles, tasks] = await Promise.all([loadPreambles(), loadTasks(args.only)]);
  const [firstTask] = tasks;
  const { ref } = firstTask;
  const checkoutPath = await resolveCheckout(spawnExec, ref);
  const head = await headSha(spawnExec, checkoutPath);
  const scratchDir = await mkdtemp(join(tmpdir(), 'srcacc-nosrc-'));
  const cells = shuffle(expandCells(tasks, args.models, ARMS, args.repeats), makeRng(args.seed));
  return { cells, ctx: { checkoutPath, preambles, scratchDir }, head, ref };
};

const main = async () => {
  const args = parseArgs(process.argv);
  const { cells, ctx, head, ref } = await prepare(args);
  await mkdir(RESULTS_DIR, { recursive: true });
  const outPath = newOutPath();
  process.stdout.write(
    `ref=${ref} head=${head} cells=${cells.length} concurrency=${args.concurrency}\n`,
  );
  await runPool({ cells, concurrency: args.concurrency, ctx, exec: spawnExec, outPath });
};

const [, entryPath] = process.argv;
if (entryPath === import.meta.filename) {
  await main();
}

export { armCwd, expandCells, runOneCell };
