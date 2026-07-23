import { describe, expect, it } from 'vitest';
import { normalizeClaude, normalizeCodex } from '../pilot/lib/telemetry.mjs';
import { readFile } from 'node:fs/promises';

describe('normalizeClaude', () => {
  it('maps the Claude usage object to separated components', () => {
    const json = {
      result: 'ok',
      usage: {
        cache_creation_input_tokens: 40,
        cache_read_input_tokens: 100,
        input_tokens: 12,
        output_tokens: 3,
      },
    };
    expect(normalizeClaude(json)).toStrictEqual({
      cache_read: 100,
      cache_write: 40,
      cache_write_1h: undefined,
      cache_write_5m: undefined,
      input_uncached: 12,
      invalid: false,
      model: 'claude',
      output: 3,
      provider_cost_usd: undefined,
      reasoning: undefined,
      reported: false,
    });
  });

  it('exposes the TTL cache-write split and provider cost when present', () => {
    const ephemeral5m = 10;
    const ephemeral1h = 30;
    const providerCost = 0.42;
    const json = {
      total_cost_usd: providerCost,
      usage: {
        cache_creation: {
          ephemeral_1h_input_tokens: ephemeral1h,
          ephemeral_5m_input_tokens: ephemeral5m,
        },
        cache_creation_input_tokens: 40,
        input_tokens: 12,
        output_tokens: 3,
      },
    };
    const telemetry = normalizeClaude(json);
    expect(telemetry.cache_write_5m).toBe(ephemeral5m);
    expect(telemetry.cache_write_1h).toBe(ephemeral1h);
    expect(telemetry.provider_cost_usd).toBe(providerCost);
  });
});

describe('normalizeCodex', () => {
  it('extracts usage from the final turn.completed event and flags missing cache components', () => {
    const raw = [
      '{"type":"turn.started"}',
      '{"type":"turn.completed","usage":{"input_tokens":200,"cached_input_tokens":150,"output_tokens":9,"reasoning_output_tokens":5}}',
    ].join('\n');
    expect(normalizeCodex(raw)).toStrictEqual({
      cache_read: 150,
      cache_write: undefined,
      cache_write_1h: undefined,
      cache_write_5m: undefined,
      input_uncached: 50,
      invalid: false,
      model: 'codex',
      // Visible output = output_tokens(9) - reasoning(5); reasoning is counted separately.
      output: 4,
      provider_cost_usd: undefined,
      reasoning: 5,
      reported: true,
    });
  });

  it('flags telemetry as invalid when codex emitted no turn.completed usage event', () => {
    expect(normalizeCodex('{"type":"turn.started"}\nplain text, no usage').invalid).toBe(true);
  });
});

describe('real captured fixtures', () => {
  it('parses the real captured Claude fixture with defined input and output', async () => {
    const json = JSON.parse(
      await readFile(new URL('../fixtures/claude-sample.json', import.meta.url), 'utf8'),
    );
    const telemetry = normalizeClaude(json);
    expect(telemetry.input_uncached).toBeDefined();
    expect(telemetry.output).toBeDefined();
  });

  it('parses the real captured Codex fixture with defined input and output', async () => {
    const raw = await readFile(new URL('../fixtures/codex-sample.jsonl', import.meta.url), 'utf8');
    const telemetry = normalizeCodex(raw);
    expect(telemetry.input_uncached).toBeDefined();
    expect(telemetry.output).toBeDefined();
  });
});
