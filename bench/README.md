# refs efficiency benchmark — pilot harness

This directory holds the **pilot** harness for empirically testing whether `refs range` /
`refs search` plus the `investigate.md` skill playbook make an LLM coding agent **more
token-efficient and faster** at answering questions about a dependency's real source **without a
meaningful loss of correctness**.

It is a _pilot_: its job is to validate the measurement **mechanics** (telemetry, judge, variance)
and produce a go/no-go decision for the rigorous full study (Phase B), not to prove the claim itself.
Full methodology: `_local/improvements/bench-design.md` (gitignored). Go/no-go: `pilot/FINDINGS.md`.

## What it does

For each **cell** = (task × model × rung × repeat) it runs a coding agent headless against a pinned
dependency checkout, captures the answer + cache-separated token telemetry + wall-time, and scores
correctness (deterministic checks first, then a blinded cross-family LLM judge over atomic facts).

- **3-rung ladder:** `naive` (no guidance) · `discipline` (plain-git playbook) · `full` (= discipline
  **plus only** the refs-command section). Rung-2/3 equivalence is enforced by a test.
- **2 models:** Claude (`claude -p`) and Codex (`codex exec --json`), each pinned.
- **Cross-family judge:** Claude answers are judged by Codex and vice-versa — never same-family.

## Layout

```
fixtures/           real captured CLI telemetry + TELEMETRY-SCHEMA.md (the Task-0 probe)
pilot/
  conditions/       naive.md · discipline.md · full.md (rung preambles)
  tasks/*.json      question + pinned commit + atomic rubric (critical_facts, material_errors)
  lib/              telemetry · runner · score · judge · stats · exec (each unit-tested)
  run.mjs           Pass A: expand cells → run + telemetry → results/<run-id>/raw.jsonl + manifest.json
  score-run.mjs     Pass B: results/<run-id>/raw.jsonl → judge → results/<run-id>/scored.jsonl
  analyze.mjs       results → per-(model,rung) summary + repeat variance + rough required-N
  results/<run-id>/ manifest.json + raw.jsonl (Pass A) + scored.jsonl (Pass B), gitignored
test/               vitest specs (run via bench/vitest.config.mjs)
```

## Run it

```bash
export PATH="$HOME/.nvm/versions/node/v26.4.0/bin:$PATH"
# unit tests (fakes/fixtures only — no CLI calls, no cost):
pnpm exec vitest run --config bench/vitest.config.mjs
# the real pilot (spawns claude/codex per cell — costs tokens + time):
node bench/pilot/run.mjs --repeats 3          # Pass A: answers + telemetry → results/<run-id>/raw.jsonl
node bench/pilot/score-run.mjs --input <run-id>  # Pass B: judge → results/<run-id>/scored.jsonl
node bench/pilot/analyze.mjs
```

## Honesty caveats (read before quoting any number)

- **Within-model comparison only.** Claude and Codex use different tokenizers and different native
  product harnesses; absolute token counts are **not** comparable across models. Valid: each model's
  rung-to-rung deltas and % reduction vs its own baseline. Invalid: "Claude Nk vs Codex Mk".
- **Reported tokens.** Codex exposes cache-**read** but no cache-**write** component, so Codex token
  totals are `reported` with that documented exclusion. Claude is fully cache-separated.
- **Launch isolation is load-bearing.** Every cell strips the CLI's plugins/skills/hooks/memory
  (`--ignore-user-config` for Codex; `--setting-sources '' --strict-mcp-config
--disable-slash-commands` for Claude) so the globally-enabled `refs` plugin cannot leak into the
  control rungs. `refs` enters only in rung 3, only as an explicit CLI call in the `full` preamble.
- **References are authored from the raw checkout**, never through `refs`, so the tool's view is not
  baked into ground truth.
- **Setup cost.** The one-time `refs sync` clone is a cold-start cost, not counted per-query here.
- **Pilot power is a rough normal-approximation placeholder** — the rigorous task-cluster bootstrap
  non-inferiority analysis is Phase B.
