import { PRICING_AS_OF, costWeighted, priceOf } from '../pilot/lib/pricing.mjs';
import { describe, expect, it } from 'vitest';

const PRICE_FIELDS = [
  'input_uncached',
  'cache_write_5m',
  'cache_write_1h',
  'cache_read',
  'output',
  'reasoning',
];
const MODELS = ['claude-opus-4-8', 'gpt-5.6-sol'];
const ZERO = 0;

const CLAUDE_FULL = {
  cache_read: 15_079,
  cache_write: 17_701,
  cache_write_1h: 17_701,
  cache_write_5m: 0,
  input_uncached: 2,
  model: 'claude',
  output: 4,
  reasoning: undefined,
};
const CODEX_TELEMETRY = {
  cache_read: 25_088,
  cache_write: undefined,
  input_uncached: 13_663,
  model: 'codex',
  output: 109,
  reasoning: 80,
};
// Mirrors a claude is_error:true response with partial usage: invalid:false,
// reported:true, and a missing priced component (output).
const CLAUDE_PARTIAL = {
  cache_read: 100,
  cache_write: 50,
  input_uncached: 200,
  invalid: false,
  model: 'claude',
  output: undefined,
  reported: true,
};
const claudePartialExpectedValue = () => {
  const price = priceOf('claude');
  return (
    CLAUDE_PARTIAL.input_uncached * price.input_uncached +
    CLAUDE_PARTIAL.cache_write * price.cache_write_5m +
    CLAUDE_PARTIAL.cache_read * price.cache_read
  );
};

describe('priceOf', () => {
  it('is date-stamped as of the authoring date', () => {
    expect(PRICING_AS_OF).toBe('2026-07-23');
  });

  it.each(MODELS)('exposes all six per-token price fields > 0 for %s', (model) => {
    const price = priceOf(model);
    for (const field of PRICE_FIELDS) {
      expect(price[field]).toBeGreaterThan(ZERO);
    }
  });

  it.each(MODELS)('records a source URL and the as-of date for %s', (model) => {
    const price = priceOf(model);
    expect(price.source).toMatch(/^https:\/\//u);
    expect(price.PRICING_AS_OF).toBe('2026-07-23');
  });

  it('resolves the telemetry model aliases (claude / codex)', () => {
    expect(priceOf('claude')).toStrictEqual(priceOf('claude-opus-4-8'));
    expect(priceOf('codex')).toStrictEqual(priceOf('gpt-5.6-sol'));
  });
});

describe('costWeighted', () => {
  it('prices a full claude telemetry as complete with a positive value', () => {
    const cost = costWeighted(CLAUDE_FULL, 'claude');
    expect(cost.value).toBeGreaterThan(ZERO);
    expect(cost.complete).toBe(true);
    expect(cost.missingComponents).toStrictEqual([]);
  });

  it('treats an aggregate-only cache_write as 5-minute TTL', () => {
    const withSplit = {
      cache_write_1h: 0,
      cache_write_5m: 1000,
      input_uncached: 0,
      model: 'claude',
      output: 0,
    };
    const aggregateOnly = { cache_write: 1000, input_uncached: 0, model: 'claude', output: 0 };
    expect(costWeighted(aggregateOnly, 'claude').value).toBe(
      costWeighted(withSplit, 'claude').value,
    );
  });

  it('flags a codex telemetry as incomplete (missing cache_write) — a lower-bound proxy', () => {
    const cost = costWeighted(CODEX_TELEMETRY, 'codex');
    expect(cost.value).toBeGreaterThan(ZERO);
    expect(cost.complete).toBe(false);
    expect(cost.missingComponents).toStrictEqual(['cache_write']);
  });

  it('never fabricates a cost for a censored/timeout record (undefined telemetry)', () => {
    const cost = costWeighted(undefined, 'claude');
    expect(cost.value).toBeUndefined();
    expect(cost.complete).toBe(false);
    expect(cost.missingComponents).toStrictEqual(['censored']);
  });

  it('treats invalid telemetry as censored', () => {
    const cost = costWeighted({ invalid: true, model: 'codex' }, 'codex');
    expect(cost.value).toBeUndefined();
    expect(cost.complete).toBe(false);
  });

  it('flags a partial-but-reported claude telemetry as incomplete without undercounting the value', () => {
    const cost = costWeighted(CLAUDE_PARTIAL, 'claude');
    expect(cost.complete).toBe(false);
    expect(cost.missingComponents).toStrictEqual(['output', 'reported']);
    expect(cost.value).toBe(claudePartialExpectedValue());
  });
});
