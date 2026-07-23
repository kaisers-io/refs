// Normalize each CLI's raw headless output into a cache-separated RunTelemetry.
// Field paths verified against real captures in bench/fixtures/TELEMETRY-SCHEMA.md.
//
// RunTelemetry = {
//   model, input_uncached, cache_write, cache_write_5m, cache_write_1h,
//   cache_read, output, reasoning, provider_cost_usd, invalid, reported
// }
// An absent component is `undefined` (that CLI does not emit it). `reported: true`
// means one or more components were unavailable and excluded (honesty flag); the
// downstream stats sum only the present components.
//
// cache_write_5m / cache_write_1h are the TTL breakdown of the cache-write
// aggregate. Claude reports both under `usage.cache_creation`; the pilot pricer
// prefers them and falls back to pricing the aggregate at the 5-minute (default)
// TTL when only the aggregate is present. provider_cost_usd is the CLI's own
// rated cost estimate (Claude's top-level `total_cost_usd`), stored as a
// cross-check; codex does not emit it.

const CODEX_USAGE_EVENT = 'turn.completed';
const NO_CACHED_TOKENS = 0;
const NO_REASONING = 0;

const normalizeClaude = (json) => {
  const usage = json.usage ?? {};
  const creation = usage.cache_creation ?? {};
  return {
    cache_read: usage.cache_read_input_tokens,
    cache_write: usage.cache_creation_input_tokens,
    cache_write_1h: creation.ephemeral_1h_input_tokens,
    cache_write_5m: creation.ephemeral_5m_input_tokens,
    input_uncached: usage.input_tokens,
    invalid: json.usage === undefined,
    model: 'claude',
    output: usage.output_tokens,
    // Provider-rated cost estimate (top-level), stored as a cross-check.
    provider_cost_usd: json.total_cost_usd,
    reasoning: usage.reasoning_output_tokens,
    reported: usage.input_tokens === undefined || usage.output_tokens === undefined,
  };
};

const parseJsonLine = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    // Non-JSON line (plain-text output) — not a usage event.
    return line;
  }
};

// Codex emits a JSONL event stream. Parse every line into its event object;
// non-JSON lines survive as raw strings so consumers can `?.`-skip them.
const parseCodexEvents = (raw) => raw.split('\n').map((line) => parseJsonLine(line));

// The last `turn.completed` event carries cumulative usage.
const lastCodexUsage = (raw) =>
  parseCodexEvents(raw).findLast(
    (event) => event?.type === CODEX_USAGE_EVENT && event?.usage !== undefined,
  )?.usage;

// Codex reports total input including cache; uncached = total - cached-read.
const codexUncachedInput = (usage) => {
  const total = usage.input_tokens;
  if (total === undefined) {
    return total;
  }
  return total - (usage.cached_input_tokens ?? NO_CACHED_TOKENS);
};

// Codex `output_tokens` INCLUDES reasoning tokens; separate them so a summed total
// never double-counts reasoning (visible output = output_tokens - reasoning).
const codexVisibleOutput = (usage) => {
  const total = usage.output_tokens;
  if (total === undefined) {
    return total;
  }
  return total - (usage.reasoning_output_tokens ?? NO_REASONING);
};

const normalizeCodex = (raw) => {
  const usage = lastCodexUsage(raw);
  const found = usage ?? {};
  return {
    cache_read: found.cached_input_tokens,
    // Codex does not emit any cache-write component (aggregate or TTL split).
    cache_write: found.cache_creation_input_tokens,
    cache_write_1h: undefined,
    cache_write_5m: undefined,
    input_uncached: codexUncachedInput(found),
    invalid: usage === undefined,
    model: 'codex',
    output: codexVisibleOutput(found),
    // Codex exec does not report a rated cost.
    provider_cost_usd: undefined,
    reasoning: found.reasoning_output_tokens,
    reported: true,
  };
};

export { normalizeClaude, normalizeCodex, parseCodexEvents };
