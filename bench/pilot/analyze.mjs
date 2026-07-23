// Descriptive analyzer (Task 7): read results/<run-id>/scored.jsonl and print, per
// model, the tables that answer "does adding refs cut cost, and WHERE".
//
// The headline efficiency number is the COST-WEIGHTED native-token spend, never a
// summed-token "total" (that stays a labeled trajectory proxy). Codex cost is
// structurally a lower bound (no cache-write telemetry) and is flagged everywhere.
//
// The where-refs-win table is DESCRIPTIVE: Full-Discipline cost deltas split by
// tool_target and a per-construct burden tertile, with a task-level bootstrap CI for
// transparency. It is NOT a powered interaction test (see the printed caveat).
//
// All table logic lives in the pure builders in lib/analysis.mjs (imported here and
// unit-tested there directly, without spawning); main() is a thin I/O shell.

import {
  buildCellRows,
  buildComplianceRows,
  buildDepDeltas,
  buildTaskDeltas,
  buildTrajectoryRows,
  buildWhereRefsWinRows,
} from './lib/analysis.mjs';
import { fileURLToPath } from 'node:url';
import { loadCorpusTasks } from './lib/tasks-loader.mjs';
import { makeRng } from './lib/stats.mjs';
import { readFile } from 'node:fs/promises';

const RESULTS_DIR = new URL('results/', import.meta.url);
const TASKS_DIR = fileURLToPath(new URL('tasks/', import.meta.url));

const ONE = 1;
const PERCENT = 100;
const USD_DP = 4;
// The runner SIGKILLs a hung child with this cap (lib/exec.mjs DEFAULT_TIMEOUT_MS).
const TIMEOUT_CAP_MS = 360_000;
// Bootstrap: 0.05 -> 95% CI; a fixed seed keeps the descriptive CIs reproducible.
const BOOTSTRAP_ITERATIONS = 2000;
const BOOTSTRAP_ALPHA = 0.05;
const BOOTSTRAP_SEED = 20_260_723;

const COMPONENT_KEYS = [
  'input_uncached',
  'cache_write_5m',
  'cache_write_1h',
  'cache_read',
  'output',
  'reasoning',
];

const print = (line) => process.stdout.write(`${line}\n`);

// ---- formatting --------------------------------------------------------------

const pctOf = (value) => `${Math.round(value * PERCENT)}%`;

const num = (value) => {
  if (value === undefined) {
    return 'n/a';
  }
  return String(Math.round(value));
};

const usd = (value) => {
  if (value === undefined) {
    return 'n/a';
  }
  return `$${value.toFixed(USD_DP)}`;
};

// A cost is a lower bound whenever any priced component is structurally missing
// (codex cache-write). Two label widths so tables and lists stay readable.
const boundLabel = (complete, wide) => {
  if (complete) {
    return '';
  }
  if (wide) {
    return ' [LOWER BOUND]';
  }
  return ' [LB]';
};

const costText = (cost) => {
  if (cost.value === undefined) {
    return 'n/a (all censored)';
  }
  return `${usd(cost.value)}${boundLabel(cost.complete, true)} (priced n=${cost.count})`;
};

const ciText = (row) => `${usd(row.point)} [95% CI ${usd(row.lo)}..${usd(row.hi)}]`;

// ---- printing ----------------------------------------------------------------

const printComponents = (components) =>
  COMPONENT_KEYS.map((key) => `${key}=${num(components[key])}`).join(' ');

const printCellRow = (row) => {
  print(
    `  ${row.rung}  n=${row.count} | ${printComponents(row.components)} | cost=${costText(row.cost)}`,
  );
  print(
    `        pass=${pctOf(row.rates.pass)} fail=${pctOf(row.rates.fail)} measurement_error=${pctOf(row.rates.measurementError)} timeout=${pctOf(row.rates.timeout)}`,
  );
};

const printCellTable = (rows) => {
  print('per (model, rung): component means (tokens) | cost-weighted mean (PRIMARY)');
  print('  (summed tokens are a trajectory proxy; cost-weighted spend is the headline)');
  for (const row of rows) {
    printCellRow(row);
  }
};

const printCompliance = (rows) => {
  print('\nrefs-compliance (MEASURED PATH-mediated leakage on control rungs; ideal 0%):');
  for (const row of rows) {
    print(`  ${row.model}: leak=${pctOf(row.leakRate)} (control runs n=${row.count})`);
  }
};

const printTertile = (row) => {
  print(
    `    ${row.label} burden (nTasks=${row.nTasks}): delta=${ciText(row)}${boundLabel(row.complete, true)}`,
  );
};

const printWhereRefsWin = (table) => {
  print('\nwhere does refs win: Full - Discipline cost delta (negative = refs cheaper)');
  print(
    '  descriptive engineering signal; NOT a powered interaction test; CIs are for transparency;',
  );
  print('  task-level bootstrap assumes task independence. Burden tertile is per-construct.');
  for (const group of table) {
    print(`  tool_target=${group.target}:`);
    for (const row of group.tertiles) {
      printTertile(row);
    }
  }
};

const printTaskDeltaRow = (row) => {
  print(
    `  ${row.task_id} (${row.dep}/${row.tool_target}, burden=${num(row.burden)}): ${usd(row.delta)}${boundLabel(row.complete, false)}`,
  );
};

const printTaskDeltas = (taskDeltas) => {
  print(
    '\nper-task cost delta (Full - Discipline; raw spread, 3 deps too few to cluster-bootstrap):',
  );
  for (const row of taskDeltas.toSorted((left, right) => left.delta - right.delta)) {
    printTaskDeltaRow(row);
  }
};

const printDepDeltas = (depDeltas) => {
  print('per-dep mean cost delta (Full - Discipline):');
  for (const row of depDeltas) {
    print(
      `  ${row.dep} (nTasks=${row.nTasks}): ${usd(row.meanDelta)}${boundLabel(row.complete, false)}`,
    );
  }
};

const trajToolCalls = (row) => {
  if (row.model === 'claude') {
    return 'n/a (no trace in -p json)';
  }
  return num(row.toolCalls);
};

const printTrajectory = (rows) => {
  print(
    '\ntrajectory: wall time + turns/tool_calls/tool_output_bytes (codex real; claude partial):',
  );
  for (const row of rows) {
    print(
      `  ${row.model}/${row.rung}: wall=${num(row.wallMs)}ms turns=${num(row.turns)} tool_calls=${trajToolCalls(row)} tool_bytes=${num(row.toolBytes)}`,
    );
  }
};

const ciOptsOf = () => ({
  alpha: BOOTSTRAP_ALPHA,
  iterations: BOOTSTRAP_ITERATIONS,
  rng: makeRng(BOOTSTRAP_SEED),
});

const reportModel = (model, runs, tasksById) => {
  const opts = { timeoutCapMs: TIMEOUT_CAP_MS };
  const modelRuns = runs.filter((run) => run.model === model);
  const taskDeltas = buildTaskDeltas(runs, model, tasksById);
  print(`\n===== ${model} =====`);
  printCellTable(buildCellRows(modelRuns, opts));
  printCompliance(buildComplianceRows(modelRuns));
  printWhereRefsWin(buildWhereRefsWinRows(taskDeltas, ciOptsOf()));
  printTaskDeltas(taskDeltas);
  printDepDeltas(buildDepDeltas(taskDeltas));
  printTrajectory(buildTrajectoryRows(modelRuns));
};

// ---- I/O shell ---------------------------------------------------------------

const NOT_FOUND = -1;
const FAIL_EXIT = 1;
const EMPTY = '';

const parseInput = (argv) => {
  const index = argv.indexOf('--input');
  if (index === NOT_FOUND) {
    return EMPTY;
  }
  return argv[index + ONE] ?? EMPTY;
};

const loadScored = async (runId) => {
  const text = await readFile(new URL(`${runId}/scored.jsonl`, RESULTS_DIR), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== EMPTY)
    .map((line) => JSON.parse(line));
};

const loadTasksById = async () => {
  const tasks = await loadCorpusTasks(TASKS_DIR);
  return Object.fromEntries(tasks.map((task) => [task.id, task]));
};

const main = async () => {
  const runId = parseInput(process.argv);
  if (runId === EMPTY) {
    process.stderr.write('FATAL: analyze.mjs requires --input <run-id>\n');
    process.exit(FAIL_EXIT);
  }
  const [runs, tasksById] = await Promise.all([loadScored(runId), loadTasksById()]);
  print(`analyzing results/${runId}/scored.jsonl (${runs.length} records)`);
  for (const model of new Set(runs.map((run) => run.model))) {
    reportModel(model, runs, tasksById);
  }
};

const [, entryPath] = process.argv;
if (entryPath === import.meta.filename) {
  await main();
}
