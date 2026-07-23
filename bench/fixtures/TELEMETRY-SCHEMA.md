# Headless CLI telemetry schema (Task 0 probe)

**Captured:** 2026-07-23 · **Real runs**, trivial prompt (`Reply with the single word: ok`).
Fixtures: `claude-sample.json`, `codex-sample.jsonl` (usable `--json` telemetry), `codex-stderr.txt`
(plain `codex exec` log — shows the opaque `tokens used 21,825` total, no cache separation).

## VERDICT: GO on telemetry — proceed to Task 1

Both CLIs emit usable **per-run** token telemetry. Claude gives fully cache-separated components.
Codex (with `--json`) gives cache-**read** separated but **no cache-write** component — so Codex
tokens are labeled `reported_tokens` with the documented exclusion below (design §8/§9). The
text-volume-proxy fallback is **not** required.

Decision-rule outcome (per plan Task 0 Step 4): *both CLIs expose input+output at minimum* → proceed.

---

## Claude — `claude -p "<prompt>" --output-format json`

stdout is a single JSON object. Token components live under `usage`:

| Component | JSON path | Sample |
|---|---|---|
| uncached input | `usage.input_tokens` | 2 |
| cache-write (creation) | `usage.cache_creation_input_tokens` | 17701 |
| cache-read | `usage.cache_read_input_tokens` | 15079 |
| output | `usage.output_tokens` | 4 |
| reasoning/thinking | *(not separately emitted)* — folded elsewhere; treat as `null` | — |

Cache-write is further broken down by TTL: `usage.cache_creation.ephemeral_1h_input_tokens` /
`ephemeral_5m_input_tokens` (informational; the total is `cache_creation_input_tokens`).

Other useful fields (top-level unless noted):
- **answer:** `result` (string) — e.g. `"ok"`.
- **cost:** `total_cost_usd` (USD, date-stamped economic cost per design §8).
- **model calls / turns:** `num_turns`; per-iteration usage under `usage.iterations[]`.
- **wall-time:** `duration_ms` (end-to-end), `duration_api_ms`, `ttft_ms`. We also time externally
  (monotonic) in the runner for a CLI-agnostic figure.
- **model id:** `modelUsage` keys (e.g. `claude-opus-4-8[1m]`); `service_tier` under `usage`.
- **error state:** `is_error`, `subtype`, `api_error_status`, `permission_denials`.
- **tool calls:** not a single counter; `num_turns` and iteration count are the available proxies.

**Availability: FULL.** All four billable token components are cache-separated. `reported=false`.

---

## Codex — `codex exec --json "<prompt>"`

**`--json` is required.** Plain `codex exec` prints only the final answer on stdout and an opaque
`tokens used: 21,825` on stderr — no cache separation. With `--json`, stdout is a JSONL event
stream; the **final `turn.completed` event** carries cumulative usage:

```json
{"type":"turn.completed","usage":{"input_tokens":38751,"cached_input_tokens":25088,"output_tokens":189,"reasoning_output_tokens":80}}
```

| Component | JSON path (on the `turn.completed` event) | Sample | Note |
|---|---|---|---|
| total input (incl. cached) | `usage.input_tokens` | 38751 | includes cached |
| cache-read | `usage.cached_input_tokens` | 25088 | |
| **uncached input** | *derived:* `input_tokens - cached_input_tokens` | 13663 | |
| cache-write (creation) | *(not emitted)* → `null` | — | **excluded component** |
| output | `usage.output_tokens` | 189 | |
| reasoning/thinking | `usage.reasoning_output_tokens` | 80 | |

Other useful fields from the JSONL stream:
- **answer:** the last `item.completed` with `item.type === "agent_message"` → `item.text`. (The
  runner must extract this, not the whole stdout — Task 2 note.)
- **tool calls:** count `item.completed` events with `item.type === "command_execution"` (each has
  `command`, `exit_code`, `status`). This gives a real tool-call count for trajectory-length metrics.
- **thread id:** `thread.started.thread_id`.
- **wall-time:** not in the stream — timed externally (monotonic) in the runner.
- **cost:** not emitted by `codex exec`.

**Availability: PARTIAL (cache-write missing).** input/output/cache-read/reasoning present;
cache-write absent. Codex tokens → `reported=true`, documented exclusion: *no cache-creation
component; `cache_read` is the only cache signal.*

### Methodological note (for FINDINGS / design §3 caveat)
`codex exec` runs under the **native product harness**: it auto-invoked the `superpowers` skill and
ran a `command_execution` before answering the trivial prompt (visible in `codex-sample.jsonl`),
inflating input to ~38k tokens and adding a tool call. Reasoning effort defaulted to `high`. This is
scaffolding, not the model's intrinsic cost — it confirms the design's "model under the native
product harness, not a clean same-harness comparison" caveat, and means **cross-model absolute token
counts are not comparable** (within-model rung contrasts only, per §8). For the real pilot we pin
Codex flags (reasoning effort, skill/hook behavior) across rungs so this stays constant within a cell.

---

## Cross-CLI mapping to `RunTelemetry` (Task 1)

| `RunTelemetry` field | Claude source | Codex source |
|---|---|---|
| `input_uncached` | `usage.input_tokens` | `input_tokens - cached_input_tokens` |
| `cache_write` | `usage.cache_creation_input_tokens` | `null` |
| `cache_read` | `usage.cache_read_input_tokens` | `usage.cached_input_tokens` |
| `output` | `usage.output_tokens` | `usage.output_tokens` |
| `reasoning` | `null` | `usage.reasoning_output_tokens` |
| `reported` | `false` | `true` (cache-write excluded) |

---

## Clean-launch isolation (load-bearing for rung-2/3 equivalence)

Both native harnesses auto-load user config: enabled **plugins**, **skills**, **hooks**, and
memory/`AGENTS.md`/`CLAUDE.md` context. On this machine the `refs` plugin/skill is enabled in *both*
CLIs — so an unconstrained launch would let the **tool under test leak into the control rungs**
(naive, discipline), breaking the design's load-bearing rung-2/3 equivalence (§3) and confounding the
`Full − Discipline` contrast. Isolation is therefore mandatory, not cosmetic. Bonus: it also removes
scaffolding token variance, tightening the power estimate. Empirically verified 2026-07-23:

### Codex — `--ignore-user-config`
```
codex exec --json --ignore-user-config \
  -c model="gpt-5.6-sol" -c model_reasoning_effort="<pinned>" -s read-only "<prompt>"
```
Skips `~/.codex/config.toml` → no plugins, no hooks, no skill auto-invocation (auth still resolves
from `CODEX_HOME`). Trivial-prompt input dropped **38,751 → 21,872** tokens; `command_execution`
events and skill loads went to **0**. Add `--ignore-rules` (skip execpolicy) / `--ephemeral` (no
session files) if wanted. Nuclear option (also drops global `AGENTS.md` + `skills/`): a throwaway
`CODEX_HOME` with only `auth.json` copied in.

### Claude — `--setting-sources '' --strict-mcp-config --disable-slash-commands`
```
claude -p "<prompt>" --output-format json \
  --setting-sources '' --strict-mcp-config --disable-slash-commands
```
Drops user/project/local settings (→ no hooks, no auto-memory, no CLAUDE.md, no superpowers
auto-inject), all non-`--mcp-config` MCP servers, and all skills. Total context dropped
**~32.8k → ~18.7k** tokens. **`--bare` does NOT work here**: it reads auth strictly from
`ANTHROPIC_API_KEY`/`apiKeyHelper` and never OAuth/keychain → `"Not logged in · Please run /login"`
under subscription auth. `--setting-sources ''` is the OAuth-preserving equivalent.

### Consequence for the rungs
`refs` enters **only in rung 3**, and **only** as an explicit `refs …` CLI invocation described in
the `full` preamble (reached via the agent's Bash/shell tool) — never via an auto-surfaced plugin or
skill. Rungs 1–2 launch with the same isolation flags and no refs mention. The ~19–21k residual on
each side is the CLI's built-in system prompt + tool schemas (the harness floor) and is not
strippable by flags; it is held constant within a model, so within-model rung contrasts stay valid.
