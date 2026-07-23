// Pass A of the two-pass harness: expand the cell grid, run each cell headless
// (isolated), append one JSON line per run to results/<run-id>/raw.jsonl — NO
// judging (Pass B, score-run.mjs, does that, so a judge crash never discards an
// expensive real answer). At run start it writes an immutable provenance manifest
// and HARD-FAILS on checkout commit drift or refs-compliance leaks.

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { applyGridFilters, parseNumberFlag, printPreflightPlan } from './lib/cli-args.mjs';
import { buildManifest, headSha, provenanceOf } from './lib/provenance.mjs';
import { failOnCommitDrift, failOnCompliance, recheckHead } from './lib/integrity.mjs';
import { loadCorpusTasks, loadSentinelTasks } from './lib/tasks-loader.mjs';
import { refsCalls, refsOnPath, rungEnv, setupShim } from './lib/refs-shim.mjs';
import { fileURLToPath } from 'node:url';
import { parseCodexEvents } from './lib/telemetry.mjs';
import { runCell } from './lib/runner.mjs';
import { spawnExec } from './lib/exec.mjs';

const CONDITIONS_DIR = new URL('conditions/', import.meta.url);
const TASKS_DIR = fileURLToPath(new URL('tasks/', import.meta.url));
const RESULTS_DIR = new URL('results/', import.meta.url);
const REFS_BIN = new URL('../../packages/cli/bin/refs.mjs', import.meta.url);

const RUNGS = ['naive', 'discipline', 'full'];
const MODELS = ['claude', 'codex'];
const RUNG_FILE = { discipline: 'discipline.md', full: 'full.md', naive: 'naive.md' };
const DEFAULT_REPEATS = 3;
const NEXT = 1;
const ZERO = 0;
const JSON_INDENT = 2;
const DEFAULT_SEED = 1;
const CODEX_COMMAND = 'command_execution';
const CODEX_ITEM_COMPLETED = 'item.completed';
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

// Count only item.completed (codex emits item.started THEN item.completed per command id) so raw.jsonl mirrors metrics.trajectory instead of double-counting.
const toolCallCount = (raw) =>
  parseCodexEvents(raw).filter(
    (event) => event?.type === CODEX_ITEM_COMPLETED && event?.item?.type === CODEX_COMMAND,
  ).length;

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

// --sentinel selects the small top-level smoke-test set (Task 8); by default the
// full tasks/<dep>/ Wave-B analytic corpus loads instead.
const loadTasks = (argv) => {
  if (argv.includes('--sentinel')) {
    return loadSentinelTasks(TASKS_DIR);
  }
  return loadCorpusTasks(TASKS_DIR);
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
  const entries = await Promise.all(
    refs.map(async (ref) => {
      const path = await resolveCheckout(ref);
      const head = await headSha(spawnExec, path);
      return [ref, { head, path }];
    }),
  );
  return Object.fromEntries(entries);
};

// Per-run env: the shim dir enters PATH only for `full`, and REFS_LOG points at
// this run's fresh log. HOME is preserved (refs needs its ~/.kaisers-io store);
// the shim's skills residual is bounded by the self-contained preamble — see
// refs-shim.mjs. spawn REPLACES env, so we spread process.env before overriding.
const rungRunEnv = (rung, shim, logPath) => {
  const { PATH, REFS_LOG } = rungEnv(rung, {
    basePath: shim.basePath,
    logPath,
    shimDir: shim.shimDir,
  });
  return { ...process.env, PATH, REFS_LOG };
};

const runOne = async ({ cell, checkouts, logPath, preambles, provenance, shim }) => {
  const { model, repeat, rung, task } = cell;
  const checkout = checkouts[task.ref];
  const started_at = new Date().toISOString();
  const result = await runCell(spawnExec, {
    cwd: checkout.path,
    env: rungRunEnv(rung, shim, logPath),
    model,
    preamble: preambles[rung],
    question: task.question,
  });
  return {
    answer: result.answer,
    cli_versions: provenance.cli_versions,
    code: result.code,
    commit_actual: checkout.head,
    commit_expected: task.commit,
    failed: result.failed,
    model,
    pricing_as_of: provenance.pricing_as_of,
    raw: result.raw,
    // Blind spot: refs_calls/refs_on_path only catch PATH-mediated `refs` (see the
    // MEASUREMENT BLIND SPOT comment in lib/refs-shim.mjs). The persisted `raw`
    // transcript closes this for CODEX only (JSONL shows command_execution); Claude's
    // raw is result+usage only, so an absolute-path call is NOT visible for claude.
    // Each invocation logs TWO lines here (phase:'start' then phase:'end') — invocation
    // COUNT = entries where phase === 'end' (filter before counting, don't use .length).
    refs_calls: await refsCalls(logPath),
    refs_on_path: shim.onPath[rung],
    refs_version: provenance.refs_version,
    repeat,
    run_id: provenance.run_id,
    rung,
    started_at,
    task_id: task.id,
    telemetry: result.telemetry,
    tool_calls: toolCallCount(result.raw),
    wall_ms: result.wall_ms,
  };
};

const errorRecord = (cell, error, provenance) => ({
  error: String(error),
  model: cell.model,
  repeat: cell.repeat,
  run_id: provenance.run_id,
  rung: cell.rung,
  task_id: cell.task.id,
});

// One failing cell must not discard the whole run: record the error and continue.
const settleCell = async (args) => {
  try {
    return await runOne(args);
  } catch (error) {
    return errorRecord(args.cell, error, args.provenance);
  }
};

const cellState = (record) => {
  if (record.error) {
    return 'ERROR';
  }
  if (record.failed) {
    return 'failed';
  }
  return 'ok';
};

const runAll = async ({ cells, checkouts, logDir, outPath, preambles, provenance, shim }) => {
  for (const [index, cell] of cells.entries()) {
    const logPath = fileURLToPath(new URL(`${index}.jsonl`, logDir));
    // eslint-disable-next-line no-await-in-loop -- cells run sequentially by design (interleaved, cache-controlled)
    const record = await settleCell({ cell, checkouts, logPath, preambles, provenance, shim });
    // eslint-disable-next-line no-await-in-loop -- append in order as each run completes
    await appendFile(outPath, `${JSON.stringify(record)}\n`);
    // eslint-disable-next-line no-await-in-loop -- verify the read-only checkout did not move
    await recheckHead(spawnExec, checkouts[cell.task.ref], cell.task);
    process.stdout.write(`${record.model}/${record.rung} ${record.task_id} ${cellState(record)}\n`);
  }
};

const newRunId = () => new Date().toISOString().replaceAll(':', '-');

// `command -v refs` per rung (full → the shim, controls → empty). Measured once
// since it depends only on the rung env, then reused per record as `refs_on_path`.
const onPathByRung = async (shim) => {
  const entries = await Promise.all(
    RUNGS.map(async (rung) => {
      const { PATH } = rungEnv(rung, { basePath: shim.basePath, shimDir: shim.shimDir });
      return [rung, await refsOnPath(spawnExec, PATH)];
    }),
  );
  return Object.fromEntries(entries);
};

const setupRun = async () => {
  const base = await setupShim(spawnExec, fileURLToPath(REFS_BIN));
  const shim = { ...base, onPath: await onPathByRung(base) };
  const runId = newRunId();
  const runDir = new URL(`${runId}/`, RESULTS_DIR);
  const logDir = new URL('refs-log/', runDir);
  await mkdir(logDir, { recursive: true });
  return {
    logDir,
    manifestPath: new URL('manifest.json', runDir),
    rawPath: new URL('raw.jsonl', runDir),
    runId,
    shim,
  };
};

// Identity replacer: pretty-print every key (avoids passing a bare `undefined`
// replacer to JSON.stringify, which the linter rejects).
const keepAll = (_key, value) => value;

const prepareRun = async ({ checkouts, preambles, seed, tasks }) => {
  const run = await setupRun();
  failOnCompliance(run.shim);
  const manifest = await buildManifest({
    checkouts,
    exec: spawnExec,
    preambles,
    refsBinPath: fileURLToPath(REFS_BIN),
    seed,
    tasks,
  });
  await writeFile(
    fileURLToPath(run.manifestPath),
    `${JSON.stringify(manifest, keepAll, JSON_INDENT)}\n`,
  );
  return { manifest, run };
};

const main = async () => {
  const repeats = parseNumberFlag(process.argv, '--repeats', DEFAULT_REPEATS);
  const seed = parseNumberFlag(process.argv, '--seed', DEFAULT_SEED);
  const [preambles, loadedTasks] = await Promise.all([loadPreambles(), loadTasks(process.argv)]);
  const { rungs, tasks } = applyGridFilters(process.argv, loadedTasks, RUNGS);
  const checkouts = await resolveCheckouts(tasks);
  failOnCommitDrift(tasks, checkouts);
  const { manifest, run } = await prepareRun({ checkouts, preambles, seed, tasks });
  const cells = shuffle(expandCells(tasks, MODELS, rungs, repeats), makeRng(seed));
  printPreflightPlan({
    cellCount: cells.length,
    cliVersions: manifest.cli_versions,
    models: MODELS,
    onPath: run.shim.onPath,
    repeats,
    runId: run.runId,
    rungs,
    seed,
    taskIds: tasks.map((task) => task.id),
  });
  await runAll({
    cells,
    checkouts,
    logDir: run.logDir,
    outPath: run.rawPath,
    preambles,
    provenance: provenanceOf(manifest, run.runId),
    shim: run.shim,
  });
};

const [, entryPath] = process.argv;
if (entryPath === import.meta.filename) {
  await main();
}

export { expandCells };
