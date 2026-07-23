/* eslint-disable no-magic-numbers -- numeric fixtures for statistics functions; naming every array element would harm readability, and the production stats.mjs stays fully strict */
import {
  bootstrapCI,
  makeRng,
  mean,
  median,
  p90,
  passRate,
  repeatVariance,
  stdev,
  totalTokens,
  withinRungTokenSummary,
} from '../pilot/lib/stats.mjs';
import { describe, expect, it } from 'vitest';

describe('stats primitives', () => {
  it('median of odd and even length', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('mean', () => {
    expect(mean([2, 4])).toBe(3);
  });

  it('passRate', () => {
    expect(passRate([true, false, true, true])).toBe(0.75);
  });

  it('p90 picks the 90th-percentile value (nearest-rank)', () => {
    expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
  });

  it('stdev is the sample (n-1) standard deviation, 0 for a single value', () => {
    expect(stdev([2, 4, 6])).toBe(2);
    expect(stdev([5])).toBe(0);
  });
});

describe('totalTokens', () => {
  it('sums only the present (non-undefined) components', () => {
    const telemetry = {
      cache_read: 100,
      cache_write: 40,
      input_uncached: 12,
      output: 3,
      reasoning: 5,
    };
    expect(totalTokens(telemetry)).toBe(160);
    expect(totalTokens({ cache_write: undefined, input_uncached: 10, output: 2 })).toBe(12);
  });
});

const RUNS = [
  { model: 'claude', repeat: 0, rung: 'naive', telemetry: { input_uncached: 100, output: 10 } },
  { model: 'claude', repeat: 1, rung: 'naive', telemetry: { input_uncached: 120, output: 10 } },
  { model: 'claude', repeat: 0, rung: 'full', telemetry: { input_uncached: 50, output: 10 } },
];

describe('within-rung aggregation', () => {
  it('summarizes tokens per (model, rung) cell', () => {
    const summary = withinRungTokenSummary(RUNS);
    const naive = summary.find((row) => row.model === 'claude' && row.rung === 'naive');
    expect(naive.count).toBe(2);
    expect(naive.mean).toBe(120);
  });

  it('reports the token spread across repeats of the same cell', () => {
    const variance = repeatVariance(RUNS);
    expect(variance.length).toBeGreaterThanOrEqual(1);
  });
});

describe('bootstrapCI', () => {
  const CI_OPTS = { alpha: 0.05, iterations: 500, rng: makeRng(42) };

  it('brackets the mean of a constant sample exactly (zero spread)', () => {
    const ci = bootstrapCI([5, 5, 5, 5], CI_OPTS);
    expect(ci).toStrictEqual({ hi: 5, lo: 5, point: 5 });
  });

  it('brackets the mean strictly for a spread sample (lo < point < hi)', () => {
    const ci = bootstrapCI([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], CI_OPTS);
    expect(ci.point).toBe(5.5);
    expect(ci.lo).toBeLessThan(ci.point);
    expect(ci.point).toBeLessThan(ci.hi);
  });

  it('is deterministic for a fixed seed', () => {
    const first = bootstrapCI([2, 4, 8, 16], { alpha: 0.05, iterations: 300, rng: makeRng(7) });
    const second = bootstrapCI([2, 4, 8, 16], { alpha: 0.05, iterations: 300, rng: makeRng(7) });
    expect(first).toStrictEqual(second);
  });
});
