/* eslint-disable no-magic-numbers -- numeric fixtures for statistics functions; naming every array element would harm readability, and the production stats.mjs stays fully strict */
import { describe, expect, it } from 'vitest';
import {
  mean,
  median,
  p90,
  passRate,
  repeatVariance,
  stdev,
  totalTokens,
  withinRungTokenSummary,
} from '../pilot/lib/stats.mjs';

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
