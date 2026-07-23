// Pure statistics helpers for the pilot analyzer. Total native tokens = sum of the
// present RunTelemetry components; absent (undefined) components contribute nothing.

const TOKEN_KEYS = ['input_uncached', 'cache_write', 'cache_read', 'output', 'reasoning'];
const ZERO = 0;
const ONE = 1;
const HALF = 2;
const PREV = 1;
const P90_FRACTION = 0.9;
// Seedable LCG (numerical-recipes constants); mirrors run.mjs so the analyzer's
// bootstrap is reproducible without pulling in Math.random.
const LCG_A = 1_664_525;
const LCG_C = 1_013_904_223;
const LCG_M = 4_294_967_296;

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

// Deterministic [0, 1) generator from an integer seed. Injected into bootstrapCI
// so no run of the analyzer ever depends on Math.random.
const makeRng = (seed) => {
  let state = seed;
  return () => {
    state = (LCG_A * state + LCG_C) % LCG_M;
    return state / LCG_M;
  };
};

// Nearest-rank percentile of an already-sorted array; rank clamped to [1, length]
// so alpha/2 near the tails never indexes out of bounds on a short resample set.
const percentileAt = (ordered, fraction) => {
  const rank = Math.ceil(fraction * ordered.length);
  const clamped = Math.min(Math.max(rank, ONE), ordered.length);
  return ordered[clamped - PREV];
};

// One bootstrap resample (with replacement) of `values`, returned as its mean.
const resampleMean = (values, rng) =>
  mean(values.map(() => values[Math.floor(rng() * values.length)]));

// Descriptive percentile bootstrap CI: resample the mean `iterations` times and
// take the alpha/2 and 1-alpha/2 percentiles of those resample means. `point` is
// the plain sample mean. A constant sample has zero spread, so lo == hi == point.
const bootstrapCI = (values, { alpha, iterations, rng }) => {
  const point = mean(values);
  const means = sorted(Array.from({ length: iterations }, () => resampleMean(values, rng)));
  return {
    hi: percentileAt(means, ONE - alpha / HALF),
    lo: percentileAt(means, alpha / HALF),
    point,
  };
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

export {
  bootstrapCI,
  groupBy,
  makeRng,
  mean,
  median,
  p90,
  passRate,
  repeatVariance,
  stdev,
  totalTokens,
  withinRungTokenSummary,
};
