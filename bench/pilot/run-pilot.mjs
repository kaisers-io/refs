// Pilot orchestrator: expand the cell grid, run each cell headless (isolated),
// score it with a blinded cross-family judge, and append one JSON line per run.
// `expandCells` is pure and unit-tested; `main()` is thin real-subprocess glue.

import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeJudge } from './lib/judge.mjs';
import { parseCodexEvents } from './lib/telemetry.mjs';
import { runCell } from './lib/runner.mjs';
import { scoreAnswer } from './lib/score.mjs';
import { spawnExec } from './lib/exec.mjs';
import { tmpdir } from 'node:os';

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
const ZERO = 0;
const OK_EXIT = 0;
const DEFAULT_SEED = 1;
const CODEX_COMMAND = 'command_execution';
// The judge grades text only — run it in a neutral dir, never the dependency checkout.
const JUDGE_CWD = tmpdir();
// Seedable LCG (numerical-recipes constants) so cell order is randomized yet reproducible.
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

// Fisher-Yates using the seeded RNG — randomizes cell order to break the fixed
// naive→discipline→full sequence (defeats order/warm-cache confounds; design §9).
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

const toolCallCount = (raw) =>
  parseCodexEvents(raw).filter((event) => event?.item?.type === CODEX_COMMAND).length;

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

const headSha = async (checkoutPath) => {
  const { stdout, code } = await spawnExec('git', ['-C', checkoutPath, 'rev-parse', 'HEAD'], {});
  if (code !== OK_EXIT) {
    return '';
  }
  return stdout.trim();
};

const resolveCheckouts = async (tasks) => {
  const refs = [...new Set(tasks.map((task) => task.ref))];
  const entries = await Promise.all(
    refs.map(async (ref) => {
      const path = await resolveCheckout(ref);
      const head = await headSha(path);
      return [ref, { head, path }];
    }),
  );
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
  const checkout = checkouts[task.ref];
  const started_at = new Date().toISOString();
  const result = await runCell(spawnExec, {
    cwd: checkout.path,
    model,
    preamble: preambles[rung],
    question: task.question,
  });
  const judge = makeJudge(spawnExec, JUDGE_OF[model], JUDGE_CWD);
  const score = await scoreAnswer(task, result.answer, judge);
  return {
    answer: result.answer,
    code: result.code,
    commit_actual: checkout.head,
    commit_expected: task.commit,
    failed: result.failed,
    model,
    raw: result.raw,
    repeat,
    rung,
    score,
    started_at,
    task_id: task.id,
    telemetry: result.telemetry,
    tool_calls: toolCallCount(result.raw),
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

const parseSeed = (argv) => {
  const index = argv.indexOf('--seed');
  if (index === NOT_FOUND) {
    return DEFAULT_SEED;
  }
  return Number(argv[index + NEXT]);
};

const warnCommitDrift = (tasks, checkouts) => {
  for (const task of tasks) {
    const checkout = checkouts[task.ref];
    if (checkout.head !== task.commit) {
      process.stdout.write(
        `WARNING: ${task.id} pins ${task.commit} but ${task.ref} HEAD is ${checkout.head}\n`,
      );
    }
  }
};

const newOutPath = () => {
  const stamp = new Date().toISOString().replaceAll(':', '-');
  return new URL(`${stamp}.jsonl`, RESULTS_DIR);
};

const main = async () => {
  const repeats = parseRepeats(process.argv);
  const seed = parseSeed(process.argv);
  const [preambles, tasks] = await Promise.all([loadPreambles(), loadTasks()]);
  const checkouts = await resolveCheckouts(tasks);
  warnCommitDrift(tasks, checkouts);
  await mkdir(RESULTS_DIR, { recursive: true });
  const outPath = newOutPath();
  const cells = shuffle(expandCells(tasks, MODELS, RUNGS, repeats), makeRng(seed));
  process.stdout.write(`seed=${seed} cells=${cells.length}\n`);
  await runAll({ cells, checkouts, outPath, preambles });
};

const [, entryPath] = process.argv;
if (entryPath === import.meta.filename) {
  await main();
}

export { expandCells };
