// Read the latest results jsonl and print: per (model, rung) pass rate + token/wall
// summaries, per-cell repeat variance, and a ROUGH required-N estimate for the
// Full-vs-Discipline token contrast. The rough N is a normal-approximation
// placeholder — the rigorous task-cluster bootstrap power analysis is Phase B.

import { mean, p90, passRate, repeatVariance, stdev, totalTokens } from './lib/stats.mjs';
import { readFile, readdir } from 'node:fs/promises';

const RESULTS_DIR = new URL('results/', import.meta.url);
// Z_ALPHA: two-sided alpha = 0.05. Z_BETA: power = 0.80.
const Z_ALPHA = 1.96;
const Z_BETA = 0.84;
const TWO_GROUPS = 2;
const PERCENT = 100;
const ZERO = 0;
const DISCIPLINE = 'discipline';
const FULL = 'full';

const print = (line) => process.stdout.write(`${line}\n`);

const latestResultsFile = async () => {
  const files = await readdir(RESULTS_DIR);
  const jsonl = files.filter((name) => name.endsWith('.jsonl'));
  const [newest] = jsonl.toSorted().toReversed();
  return newest;
};

const loadRuns = async (file) => {
  const text = await readFile(new URL(file, RESULTS_DIR), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
};

const cellRuns = (runs, model, rung) =>
  runs.filter((run) => run.model === model && run.rung === rung);

const pct = (fraction) => `${Math.round(fraction * PERCENT)}%`;

const printCellRow = (runs, model, rung) => {
  const cell = cellRuns(runs, model, rung);
  if (cell.length === ZERO) {
    return;
  }
  const tokens = cell.map((run) => totalTokens(run.telemetry));
  const rate = pct(passRate(cell.map((run) => run.score.pass)));
  const wall = Math.round(mean(cell.map((run) => run.wall_ms)));
  const meanTok = Math.round(mean(tokens));
  const p90Tok = Math.round(p90(tokens));
  print(`${model}/${rung}  ->  ${cell.length} | ${rate} | ${meanTok} | ${p90Tok} | ${wall}`);
};

const printCellTable = (runs) => {
  const models = [...new Set(runs.map((run) => run.model))];
  const rungs = [...new Set(runs.map((run) => run.rung))];
  print('model/rung  ->  n | pass | meanTok | p90Tok | meanWall(ms)');
  for (const model of models) {
    for (const rung of rungs) {
      printCellRow(runs, model, rung);
    }
  }
};

const printRepeatVariance = (runs) => {
  print('\nrepeat variance (token stdev per model/rung/task cell):');
  for (const row of repeatVariance(runs)) {
    print(
      `  ${row.model}/${row.rung}/${row.task_id}: n=${row.count} stdev=${Math.round(row.stdev)}`,
    );
  }
};

const requiredN = (delta, pooled) => {
  const zSum = Z_ALPHA + Z_BETA;
  return Math.ceil((zSum * zSum * TWO_GROUPS * pooled * pooled) / (delta * delta));
};

const nText = (delta, pooled) => {
  if (delta === ZERO) {
    return 'undefined (no observed effect)';
  }
  return String(requiredN(delta, pooled));
};

const printModelPower = (runs, model) => {
  const full = cellRuns(runs, model, FULL).map((run) => totalTokens(run.telemetry));
  const disc = cellRuns(runs, model, DISCIPLINE).map((run) => totalTokens(run.telemetry));
  if (full.length === ZERO || disc.length === ZERO) {
    return;
  }
  const delta = Math.abs(mean(full) - mean(disc));
  const sFull = stdev(full);
  const sDisc = stdev(disc);
  const pooled = Math.sqrt((sFull * sFull + sDisc * sDisc) / TWO_GROUPS);
  print(
    `  ${model}: delta=${Math.round(delta)} tok, pooled_sd=${Math.round(pooled)}, n/cond≈${nText(delta, pooled)}`,
  );
};

const printPowerEstimate = (runs) => {
  print('\nrough required-N per condition for the Full-vs-Discipline token contrast:');
  print(
    '(normal approx n = (z_a+z_b)^2 * 2 * s^2 / delta^2; pilot placeholder, not the Phase-B bootstrap)',
  );
  const models = [...new Set(runs.map((run) => run.model))];
  for (const model of models) {
    printModelPower(runs, model);
  }
};

const main = async () => {
  const file = await latestResultsFile();
  if (file === undefined) {
    print('no results/*.jsonl found — run run-pilot.mjs first.');
    return;
  }
  print(`analyzing ${file}`);
  const runs = await loadRuns(file);
  print(`${runs.length} runs\n`);
  printCellTable(runs);
  printRepeatVariance(runs);
  printPowerEstimate(runs);
};

await main();
