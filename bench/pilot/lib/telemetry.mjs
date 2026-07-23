// Normalize each CLI's raw headless output into a cache-separated RunTelemetry.
// Field paths verified against real captures in bench/fixtures/TELEMETRY-SCHEMA.md.
//
// RunTelemetry = {
//   model, input_uncached, cache_write, cache_read, output, reasoning, reported
// }
// An absent component is `undefined` (that CLI does not emit it). `reported: true`
// means one or more components were unavailable and excluded (honesty flag); the
// downstream stats sum only the present components.

const CODEX_USAGE_EVENT = 'turn.completed';
const NO_CACHED_TOKENS = 0;

const normalizeClaude = (json) => {
  const usage = json.usage ?? {};
  return {
    cache_read: usage.cache_read_input_tokens,
    cache_write: usage.cache_creation_input_tokens,
    input_uncached: usage.input_tokens,
    model: 'claude',
    output: usage.output_tokens,
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

// Codex emits JSONL events; the last `turn.completed` carries cumulative usage.
const lastCodexUsage = (raw) =>
  raw
    .split('\n')
    .map((line) => parseJsonLine(line))
    .findLast((event) => event?.type === CODEX_USAGE_EVENT && event.usage !== undefined)?.usage;

// Codex reports total input including cache; uncached = total - cached-read.
const codexUncachedInput = (usage) => {
  const total = usage.input_tokens;
  if (total === undefined) {
    return total;
  }
  return total - (usage.cached_input_tokens ?? NO_CACHED_TOKENS);
};

const normalizeCodex = (raw) => {
  const usage = lastCodexUsage(raw) ?? {};
  return {
    cache_read: usage.cached_input_tokens,
    cache_write: usage.cache_creation_input_tokens,
    input_uncached: codexUncachedInput(usage),
    model: 'codex',
    output: usage.output_tokens,
    reasoning: usage.reasoning_output_tokens,
    reported: true,
  };
};

export { normalizeClaude, normalizeCodex };
