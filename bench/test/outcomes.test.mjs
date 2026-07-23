import { describe, expect, it } from 'vitest';
import { classifyRun } from '../pilot/lib/outcomes.mjs';

const TIMEOUT_CAP_MS = 360_000;
const OVER_CAP_MS = 400_000;
const NORMAL_MS = 5000;
const TIMEOUT_CODE = -1;
const NONZERO_CODE = 1;
const OK_CODE = 0;
const OPTS = { timeoutCapMs: TIMEOUT_CAP_MS };

const telemetry = { input_uncached: 10, model: 'claude', output: 5 };

// Base valid record; overrides model each failure/success shape under test.
const rec = (overrides) => ({
  code: OK_CODE,
  failed: false,
  telemetry,
  wall_ms: NORMAL_MS,
  ...overrides,
});

describe('classifyRun', () => {
  it('classifies a CLI timeout as fail with a censored cost and capped time', () => {
    const out = classifyRun(
      rec({ code: TIMEOUT_CODE, failed: true, telemetry: undefined, wall_ms: OVER_CAP_MS }),
      OPTS,
    );
    expect(out.correctness).toBe('fail');
    expect(out.costCensored).toBe(true);
    expect(out.timeMs).toBe(TIMEOUT_CAP_MS);
  });

  it('classifies a non-zero CLI exit as fail with a censored cost', () => {
    const out = classifyRun(rec({ code: NONZERO_CODE, failed: true, telemetry: undefined }), OPTS);
    expect(out.correctness).toBe('fail');
    expect(out.costCensored).toBe(true);
  });

  it('classifies a judge failure as measurement_error, retryable, cost NOT censored', () => {
    const out = classifyRun(rec({ score_error: 'Error: judge boom' }), OPTS);
    expect(out.correctness).toBe('measurement_error');
    expect(out.retryable).toBe(true);
    expect(out.costCensored).toBe(false);
  });

  it('classifies a valid passing record as pass with an uncensored cost', () => {
    const out = classifyRun(rec({ score: { pass: true } }), OPTS);
    expect(out.correctness).toBe('pass');
    expect(out.costCensored).toBe(false);
    expect(out.retryable).toBe(false);
    expect(out.timeMs).toBe(NORMAL_MS);
  });

  it('classifies a valid failing record (score.pass false) as fail', () => {
    expect(classifyRun(rec({ score: { pass: false } }), OPTS).correctness).toBe('fail');
  });

  it('marks a valid record with no telemetry as cost-censored', () => {
    expect(
      classifyRun(rec({ score: { pass: true }, telemetry: undefined }), OPTS).costCensored,
    ).toBe(true);
  });
});
