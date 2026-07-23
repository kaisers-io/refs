// Pure table-builders for the Task-7 descriptive analyzer, split out of analyze.mjs
// so the report logic stays unit-testable without spawning and each file stays under
// its oxlint line cap. analyze.mjs is the printing + I/O shell over these.
//
// The headline efficiency number is COST-WEIGHTED native-token spend (pricing.mjs),
// never a summed-token total. Codex cost is structurally a lower bound (no cache-write
// telemetry) and is flagged wherever it surfaces. Burden tertiles are per-construct
// (search: output_bytes; range: commit_count) and never combined onto one scale.

import { bootstrapCI, groupBy, mean } from './stats.mjs';
import { classifyRun } from './outcomes.mjs';
import { costWeighted } from './pricing.mjs';
import { trajectory } from './metrics.mjs';

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;
const THIRD = ONE / THREE;
const TWO_THIRD = TWO / THREE;
const TIMEOUT_CODE = -1;

const FULL = 'full';
const DISCIPLINE = 'discipline';
const CONTROL_RUNGS = new Set(['discipline', 'naive']);
const LOW = 'low';
const MED = 'med';
const HIGH = 'high';
const BUCKETS = [LOW, MED, HIGH];
const COMPONENT_KEYS = [
  'input_uncached',
  'cache_write_5m',
  'cache_write_1h',
  'cache_read',
  'output',
  'reasoning',
];

// ---- cost helpers ------------------------------------------------------------

const costOf = (run) => costWeighted(run.telemetry, run.model);

// Mean cost-weighted spend over runs; censored (undefined-value) runs are EXCLUDED
// (never imputed) and completeness is flagged (codex -> lower bound).
const meanCost = (runs) => {
  const costs = runs.map((run) => costOf(run)).filter((cost) => cost.value !== undefined);
  if (costs.length === ZERO) {
    return { complete: false, count: ZERO, value: undefined };
  }
  return {
    complete: costs.every((cost) => cost.complete),
    count: costs.length,
    value: mean(costs.map((cost) => cost.value)),
  };
};

// ---- per (model, rung) cell rows --------------------------------------------

const componentMean = (runs, key) => {
  if (runs.length === ZERO) {
    return ZERO;
  }
  return mean(runs.map((run) => run.telemetry[key] ?? ZERO));
};

// A record with invalid telemetry (e.g. claude `usage` missing) has every component
// undefined; zero-filling it in would silently dilute the displayed per-component
// averages, so it is excluded from the mean rather than imputed.
const hasValidTelemetry = (run) => run.telemetry !== undefined && run.telemetry.invalid !== true;

const componentMeans = (cell) => {
  const withTelemetry = cell.filter((run) => hasValidTelemetry(run));
  return Object.fromEntries(COMPONENT_KEYS.map((key) => [key, componentMean(withTelemetry, key)]));
};

// Infra errorRecords (a `.error` field, no telemetry) are a measurement problem, not
// a model correctness fail; everything else defers to classifyRun.
const outcomeOf = (record, opts) => {
  if (record.error !== undefined) {
    return 'measurement_error';
  }
  return classifyRun(record, opts).correctness;
};

const fraction = (labels, wanted) =>
  labels.filter((label) => label === wanted).length / labels.length;

const ratesOf = (cell, opts) => {
  const labels = cell.map((run) => outcomeOf(run, opts));
  return {
    fail: fraction(labels, 'fail'),
    measurementError: fraction(labels, 'measurement_error'),
    pass: fraction(labels, 'pass'),
    timeout: cell.filter((run) => run.code === TIMEOUT_CODE).length / cell.length,
  };
};

const cellRow = (cell, opts) => {
  const [first] = cell;
  return {
    components: componentMeans(cell),
    cost: meanCost(cell),
    count: cell.length,
    model: first.model,
    rates: ratesOf(cell, opts),
    rung: first.rung,
  };
};

// One row per (model, rung); every record counts toward the rate denominators (infra
// errors / skipped-judge runs are never silently dropped).
const buildCellRows = (runs, opts) =>
  [...groupBy(runs, (run) => `${run.model}::${run.rung}`).values()].map((cell) =>
    cellRow(cell, opts),
  );

// ---- refs-compliance (measured leakage) -------------------------------------

// A control-rung run "leaked" refs if the shim resolved on PATH OR the invocation log
// recorded any call. MEASURED-leakage only (PATH-mediated; see the blind-spot note in
// lib/refs-shim.mjs) — ideally 0% given Task 2 isolation.
const leaked = (record) =>
  Boolean(record.refs_on_path) || (record.refs_calls?.length ?? ZERO) > ZERO;

const leakRate = (rows) => {
  if (rows.length === ZERO) {
    return ZERO;
  }
  return rows.filter((row) => leaked(row)).length / rows.length;
};

const buildComplianceRows = (runs) => {
  const controls = runs.filter((run) => CONTROL_RUNGS.has(run.rung));
  return [...groupBy(controls, (run) => run.model).entries()].map(([model, rows]) => ({
    count: rows.length,
    leakRate: leakRate(rows),
    model,
  }));
};

// ---- per-task Full-Discipline cost deltas -----------------------------------

// Per-construct burden magnitude (search and range burdens don't share a scale, so
// they are never combined). undefined for the neither-tool target (no burden key).
const BURDEN_KEY = { range: 'commit_count', search: 'output_bytes' };

const burdenValueOf = (task) => task.burden?.[BURDEN_KEY[task.tool_target]];

// Full-minus-Discipline cost delta for ONE task (negative = refs cheaper); undefined
// when either rung has no non-censored cost for this task.
const taskDeltaRow = (taskId, taskRuns, tasksById) => {
  const full = meanCost(taskRuns.filter((run) => run.rung === FULL));
  const disc = meanCost(taskRuns.filter((run) => run.rung === DISCIPLINE));
  if (full.value === undefined || disc.value === undefined) {
    return;
  }
  const task = tasksById[taskId] ?? {};
  return {
    burden: burdenValueOf(task),
    complete: full.complete && disc.complete,
    delta: full.value - disc.value,
    dep: task.dep,
    task_id: taskId,
    tool_target: task.tool_target,
  };
};

const buildTaskDeltas = (runs, model, tasksById) => {
  const forModel = runs.filter((run) => run.model === model);
  const rows = [];
  for (const [taskId, taskRuns] of groupBy(forModel, (run) => run.task_id)) {
    const row = taskDeltaRow(taskId, taskRuns, tasksById);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
};

// ---- where-refs-win table (tool_target x burden tertile) --------------------

const bucketOf = (index, count) => {
  const rank = index / count;
  if (rank < THIRD) {
    return LOW;
  }
  if (rank < TWO_THIRD) {
    return MED;
  }
  return HIGH;
};

// Rank-based tertiles keep the three buckets balanced even for a small corpus.
const tertileByRank = (deltas) => {
  const ordered = deltas.toSorted((left, right) => left.burden - right.burden);
  return new Map(ordered.map((delta, index) => [delta.task_id, bucketOf(index, ordered.length)]));
};

const statRow = (label, deltas, ciOpts) => {
  const ci = bootstrapCI(
    deltas.map((delta) => delta.delta),
    ciOpts,
  );
  return {
    complete: deltas.every((delta) => delta.complete),
    hi: ci.hi,
    label,
    lo: ci.lo,
    nTasks: deltas.length,
    point: ci.point,
  };
};

// Tertile rows for one tool_target group. A group with no numeric burden (the neither
// target) collapses to a single "all" row rather than an invented split.
const tertileRows = (deltas, ciOpts) => {
  const withBurden = deltas.filter((delta) => typeof delta.burden === 'number');
  if (withBurden.length === ZERO) {
    return [statRow('all', deltas, ciOpts)];
  }
  const labels = tertileByRank(withBurden);
  const byBucket = groupBy(withBurden, (delta) => labels.get(delta.task_id));
  return BUCKETS.filter((bucket) => byBucket.has(bucket)).map((bucket) =>
    statRow(bucket, byBucket.get(bucket), ciOpts),
  );
};

const buildWhereRefsWinRows = (taskDeltas, ciOpts) =>
  [...groupBy(taskDeltas, (delta) => delta.tool_target ?? 'unknown').entries()].map(
    ([target, deltas]) => ({ target, tertiles: tertileRows(deltas, ciOpts) }),
  );

const buildDepDeltas = (taskDeltas) =>
  [...groupBy(taskDeltas, (delta) => delta.dep ?? 'unknown').entries()].map(([dep, deltas]) => ({
    complete: deltas.every((delta) => delta.complete),
    dep,
    meanDelta: mean(deltas.map((delta) => delta.delta)),
    nTasks: deltas.length,
  }));

// ---- trajectory (wall time + tool metrics) ----------------------------------

const meanDefined = (values) => {
  const defined = values.filter((value) => value !== undefined);
  if (defined.length === ZERO) {
    return;
  }
  return mean(defined);
};

// Infra-error records (Pass-A errorRecord: `{error, model, repeat, rung, task_id}`,
// no `raw`) have no real trajectory. Feeding them to trajectory() would yield honest
// (per metrics.mjs) but WRONG-FOR-THIS-CELL zero counts that dilute the mean, so they
// are excluded from the trajectory denominator rather than counted as real zeros.
const hasUsableRaw = (run) => typeof run.raw === 'string' && run.raw.length > ZERO;

const trajRow = (cell) => {
  const [first] = cell;
  const trajs = cell
    .filter((run) => hasUsableRaw(run))
    .map((run) => trajectory(run.raw, run.model));
  return {
    model: first.model,
    rung: first.rung,
    toolBytes: meanDefined(trajs.map((traj) => traj.tool_output_bytes)),
    toolCalls: meanDefined(trajs.map((traj) => traj.tool_calls)),
    turns: meanDefined(trajs.map((traj) => traj.turns)),
    wallMs: meanDefined(cell.map((run) => run.wall_ms)),
  };
};

const buildTrajectoryRows = (runs) =>
  [...groupBy(runs, (run) => `${run.model}::${run.rung}`).values()].map((cell) => trajRow(cell));

export {
  buildCellRows,
  buildComplianceRows,
  buildDepDeltas,
  buildTaskDeltas,
  buildTrajectoryRows,
  buildWhereRefsWinRows,
};
