// Pure statistics helpers for the pilot analyzer. Total native tokens = sum of the
// present RunTelemetry components; absent (undefined) components contribute nothing.

const TOKEN_KEYS = ['input_uncached', 'cache_write', 'cache_read', 'output', 'reasoning'];
const ZERO = 0;
const HALF = 2;
const PREV = 1;
const P90_FRACTION = 0.9;

const sum = (xs) => xs.reduce((acc, value) => acc + value, ZERO);

const mean = (xs) => sum(xs) / xs.length;

const sorted = (xs) => xs.toSorted((left, right) => left - right);

const median = (xs) => {
  const ordered = sorted(xs);
  const mid = Math.floor(ordered.length / HALF);
  const isEven = ordered.length % HALF === ZERO;
  if (isEven) {
    return (ordered[mid - PREV] + ordered[mid]) / HALF;
  }
  return ordered[mid];
};

// Nearest-rank 90th percentile.
const p90 = (xs) => {
  const ordered = sorted(xs);
  const rank = Math.ceil(P90_FRACTION * ordered.length);
  return ordered[rank - PREV];
};

const passRate = (bools) => bools.filter((flag) => flag === true).length / bools.length;

const totalTokens = (telemetry) =>
  TOKEN_KEYS.reduce((acc, key) => acc + (telemetry[key] ?? ZERO), ZERO);

// Sample standard deviation (Bessel's ÷(n-1)); 0 for n <= 1 (no spread definable).
const stdev = (xs) => {
  if (xs.length <= PREV) {
    return ZERO;
  }
  const avg = mean(xs);
  const squaredDiffs = xs.map((value) => (value - avg) * (value - avg));
  return Math.sqrt(sum(squaredDiffs) / (xs.length - PREV));
};

const groupBy = (items, keyOf) => {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = map.get(key) ?? [];
    bucket.push(item);
    map.set(key, bucket);
  }
  return map;
};

const cellTokens = (bucket) => bucket.map((run) => totalTokens(run.telemetry));

// One summary row per (model, rung) over total native tokens across ALL its runs.
const withinRungTokenSummary = (runs) => {
  const groups = groupBy(runs, (run) => `${run.model}::${run.rung}`);
  const rows = [];
  for (const bucket of groups.values()) {
    const tokens = cellTokens(bucket);
    const [first] = bucket;
    rows.push({
      count: tokens.length,
      mean: mean(tokens),
      median: median(tokens),
      model: first.model,
      p90: p90(tokens),
      rung: first.rung,
    });
  }
  return rows;
};

// Token spread (stdev) across repeats of the same (model, rung, task) cell — the
// number that feeds the power estimate.
const repeatVariance = (runs) => {
  const groups = groupBy(runs, (run) => `${run.model}::${run.rung}::${run.task_id}`);
  const rows = [];
  for (const bucket of groups.values()) {
    const tokens = cellTokens(bucket);
    const [first] = bucket;
    rows.push({
      count: tokens.length,
      model: first.model,
      rung: first.rung,
      stdev: stdev(tokens),
      task_id: first.task_id,
    });
  }
  return rows;
};

export { mean, median, p90, passRate, repeatVariance, stdev, totalTokens, withinRungTokenSummary };
