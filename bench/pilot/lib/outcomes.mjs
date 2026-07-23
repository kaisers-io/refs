// Failure-classification policy for one scored run. Separates a model correctness
// signal from measurement noise and marks when a run's COST is unknowable.
//
// correctness:
//   'pass'              — valid telemetry + score.pass === true.
//   'fail'              — a CLI timeout / non-zero exit, OR a valid run graded fail.
//   'measurement_error' — the judge itself failed (score_error); excluded from the
//                         correctness rate, reported, and retried exactly once.
//
// Retry rule (uniform, documented for the runner/score pass): a measurement_error
// is retried once; BOTH attempts' telemetry are counted toward cost — dropping the
// failed attempt would bias rungs that fail the judge more often. classifyRun only
// marks a record `retryable`; the orchestration lives in the score pass.
//
// costCensored: a CLI timeout has a real but UNKNOWN dollar cost — we must NOT
// impute the time cap as a cost. Any run without valid telemetry is cost-censored;
// downstream pricing returns an undefined value for it rather than fabricating one.

const OK_CODE = 0;

const cappedTime = (wallMs, timeoutCapMs) => {
  if (wallMs === undefined) {
    return timeoutCapMs;
  }
  return Math.min(wallMs, timeoutCapMs);
};

// A CLI-level failure: the runner flagged it, or the process exited non-zero (the
// timeout resolves with a negative code, also caught here).
const isCliFailure = (record) =>
  record.failed === true || (typeof record.code === 'number' && record.code !== OK_CODE);

const correctnessOf = (record) => {
  if (record.score?.pass === true) {
    return 'pass';
  }
  return 'fail';
};

const classifyRun = (record, { timeoutCapMs }) => {
  const timeMs = cappedTime(record.wall_ms, timeoutCapMs);
  // Judge failure: a measurement problem, not a model outcome. Its attempt cost is
  // real (telemetry usually present), so it is NOT censored when telemetry exists.
  if (record.score_error !== undefined) {
    return {
      correctness: 'measurement_error',
      costCensored: record.telemetry === undefined,
      retryable: true,
      timeMs,
    };
  }
  // A timeout / non-zero exit is a correctness fail whose cost is unknown (censored).
  if (isCliFailure(record)) {
    return { correctness: 'fail', costCensored: true, retryable: false, timeMs };
  }
  return {
    correctness: correctnessOf(record),
    costCensored: record.telemetry === undefined,
    retryable: false,
    timeMs,
  };
};

export { classifyRun };
