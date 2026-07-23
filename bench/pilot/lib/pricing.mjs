// Real, TTL-aware per-token prices and a cost-weighted aggregator that never
// silently zeroes an unknown component and flags every incompleteness.
//
// Prices are provider LIST prices (API-list-price equivalent), USD per token,
// verified 2026-07-23. This is the rate-card cost of the tokens a run consumed —
// NOT the user's actual subscription spend (a Max/Team plan bills differently);
// it is the correct unit for a cross-rung efficiency contrast. Claude verified
// via the authoritative claude-api pricing source; GPT-5.6 from the OpenAI model
// page. Divide each per-MTok figure by PER_MTOK to get the per-token rate.

const PER_MTOK = 1_000_000;
const PRICING_AS_OF = '2026-07-23';
const ZERO = 0;

// Claude Opus 4.8 (standard tier). Thinking tokens bill at the output rate.
const CLAUDE_INPUT_PER_MTOK = 5;
const CLAUDE_CACHE_WRITE_5M_PER_MTOK = 6.25;
const CLAUDE_CACHE_WRITE_1H_PER_MTOK = 10;
const CLAUDE_CACHE_READ_PER_MTOK = 0.5;
const CLAUDE_OUTPUT_PER_MTOK = 25;
const CLAUDE_REASONING_PER_MTOK = 25;

// GPT-5.6-sol. cache_write_* are a PROXY (1.25x input): codex telemetry does not
// expose cache-write tokens, so these rates only bound an upper estimate — the
// real codex cost priced from telemetry is a LOWER bound (see costWeighted).
const GPT_INPUT_PER_MTOK = 5;
const GPT_CACHE_WRITE_PER_MTOK = 6.25;
const GPT_CACHE_READ_PER_MTOK = 0.5;
const GPT_OUTPUT_PER_MTOK = 30;
const GPT_REASONING_PER_MTOK = 30;

const perToken = (perMTok) => perMTok / PER_MTOK;

const CLAUDE_PRICE = {
  PRICING_AS_OF,
  cache_read: perToken(CLAUDE_CACHE_READ_PER_MTOK),
  cache_write_1h: perToken(CLAUDE_CACHE_WRITE_1H_PER_MTOK),
  cache_write_5m: perToken(CLAUDE_CACHE_WRITE_5M_PER_MTOK),
  input_uncached: perToken(CLAUDE_INPUT_PER_MTOK),
  output: perToken(CLAUDE_OUTPUT_PER_MTOK),
  reasoning: perToken(CLAUDE_REASONING_PER_MTOK),
  source: 'https://platform.claude.com/docs/en/pricing',
  tier: 'standard',
};

const GPT_PRICE = {
  PRICING_AS_OF,
  cache_read: perToken(GPT_CACHE_READ_PER_MTOK),
  cache_write_1h: perToken(GPT_CACHE_WRITE_PER_MTOK),
  cache_write_5m: perToken(GPT_CACHE_WRITE_PER_MTOK),
  input_uncached: perToken(GPT_INPUT_PER_MTOK),
  output: perToken(GPT_OUTPUT_PER_MTOK),
  reasoning: perToken(GPT_REASONING_PER_MTOK),
  source: 'https://developers.openai.com/api/docs/models/gpt-5.6-sol',
  tier: 'standard',
};

// Canonical prices keyed by model id; telemetry model tags ('claude'/'codex') are
// aliases resolved to these.
const PRICES = {
  'claude-opus-4-8': CLAUDE_PRICE,
  'gpt-5.6-sol': GPT_PRICE,
};

const ALIASES = {
  claude: 'claude-opus-4-8',
  'claude-opus-4-8': 'claude-opus-4-8',
  codex: 'gpt-5.6-sol',
  'gpt-5.6-sol': 'gpt-5.6-sol',
};

// Codex never emits a cache-write component, so its priced cost structurally omits
// real cache-write spend and is always a lower bound.
const STRUCTURALLY_MISSING = {
  'claude-opus-4-8': [],
  'gpt-5.6-sol': ['cache_write'],
};

const canonical = (model) => ALIASES[model] ?? model;

const priceOf = (model) => PRICES[canonical(model)];

// Cache-write cost, TTL-aware: prefer an explicit 5m/1h split; fall back to the
// aggregate priced at the 5-minute (default) TTL. Returns undefined when no
// cache-write component is present at all (the codex case).
const cacheWriteCost = (telemetry, price) => {
  const has5m = telemetry.cache_write_5m !== undefined;
  const has1h = telemetry.cache_write_1h !== undefined;
  if (has5m || has1h) {
    return (
      (telemetry.cache_write_5m ?? ZERO) * price.cache_write_5m +
      (telemetry.cache_write_1h ?? ZERO) * price.cache_write_1h
    );
  }
  if (telemetry.cache_write !== undefined) {
    // Aggregate-only breakdown is treated as 5-minute TTL (the API default).
    return telemetry.cache_write * price.cache_write_5m;
  }
  // No cache-write component at all (codex): contributes 0 to the lower bound.
  return ZERO;
};

// A missing token component contributes 0 to the value; an undefined but genuinely
// absent component (e.g. claude reasoning) also contributes 0 — the difference is
// tracked by STRUCTURALLY_MISSING, not by the arithmetic.
const componentCost = (tokens, rate) => (tokens ?? ZERO) * rate;

const priceableCost = (telemetry, price) =>
  componentCost(telemetry.input_uncached, price.input_uncached) +
  cacheWriteCost(telemetry, price) +
  componentCost(telemetry.cache_read, price.cache_read) +
  componentCost(telemetry.output, price.output) +
  componentCost(telemetry.reasoning, price.reasoning);

const isCensored = (telemetry) => telemetry === undefined || telemetry.invalid === true;

// Whether any cache-write signal is present at all, aggregate or TTL-split.
const hasCacheWriteComponent = (telemetry) =>
  telemetry.cache_write !== undefined ||
  telemetry.cache_write_1h !== undefined ||
  telemetry.cache_write_5m !== undefined;

// Presence checks for the priced token components a model can independently
// report. Reasoning is intentionally excluded: it is legitimately absent on most
// runs (no extended thinking used), not a reporting gap, so its absence must never
// flag incompleteness.
const COMPONENT_PRESENCE = {
  cache_read: (telemetry) => telemetry.cache_read !== undefined,
  cache_write: hasCacheWriteComponent,
  input_uncached: (telemetry) => telemetry.input_uncached !== undefined,
  output: (telemetry) => telemetry.output !== undefined,
};

// Components this model is structurally never expected to report (e.g. codex
// cache-write) are skipped here — they are already a known, labeled lower bound
// rather than a surprise gap.
const missingPricedComponents = (telemetry, structurallyMissing) =>
  Object.entries(COMPONENT_PRESENCE)
    .filter(
      ([component, isPresent]) => !structurallyMissing.includes(component) && !isPresent(telemetry),
    )
    .map(([component]) => component);

// Cost-weighted native token spend for one run. Never silently returns 0 for an
// unknown cost: a censored run (no valid telemetry) yields value undefined; a
// structurally-incomplete model (codex, no cache-write) yields complete:false and
// a labeled lower bound; a partial-but-reported run (e.g. a claude is_error:true
// response with truncated usage) is also flagged incomplete, never silently
// undercounted as complete.
const costWeighted = (telemetry, model) => {
  if (isCensored(telemetry)) {
    return { complete: false, missingComponents: ['censored'], value: undefined };
  }
  const structurallyMissing = STRUCTURALLY_MISSING[canonical(model)] ?? [];
  const missingComponents = [
    ...structurallyMissing,
    ...missingPricedComponents(telemetry, structurallyMissing),
  ];
  if (telemetry.reported === true) {
    missingComponents.push('reported');
  }
  return {
    complete: missingComponents.length === ZERO,
    // A lower bound whenever missingComponents is non-empty.
    missingComponents,
    value: priceableCost(telemetry, priceOf(model)),
  };
};

export { PRICING_AS_OF, costWeighted, priceOf };
