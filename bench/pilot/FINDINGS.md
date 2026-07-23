# Pilot findings + go/no-go

**Run:** 2026-07-23, N=3 · 54 cells (3 tasks × 2 models × 3 rungs × 3 repeats) · 0 errored.
**Scope:** mechanics validation only (per `bench-design.md` §2/§12) — NOT a test of the efficiency
claim itself. All numbers are within-model; cross-model token counts are not comparable.
**Reviewed:** whole-branch by Codex (collab headless) + Fable (high-effort subagent); their findings
are folded in below and the code-level ones are fixed on this branch (commit `e8e7fc7`).

## Recommendation: **GO on mechanics — CONDITIONAL on the Phase-B design fixes below**

The measurement machinery works end-to-end and the harness is buildable. **But the pilot + the two
reviews showed the current efficiency/correctness contrasts are not yet provable**, and the reviews
surfaced real harness bugs (now fixed) plus methodology gaps that need a re-run before Phase B is
meaningful. This is exactly what a pilot is for.

---

## The three go/no-go questions (design §12)

### (a) Cache-separated per-run telemetry from both CLIs? — **YES**
- **Claude** (`claude -p --output-format json`): fully cache-separated, `reported=false`. 27/27 clean.
- **Codex** (`codex exec --json`): `input_uncached`(derived)`/cache_read/output/reasoning`; no
  cache-write → `reported=true`. 27/27 clean. **Fixed post-review:** codex `output_tokens` *includes*
  reasoning — the normalizer now subtracts it so a summed total never double-counts (numerically tiny
  here, ~0.1%, but wrong in principle).
- 0/54 telemetry-extraction failures. Text-volume-proxy fallback not needed.

### (b) Does the atomic-fact judge agree with humans? — **NOT YET MEASURABLE (mechanics OK)**
Downgraded from a naive "yes" after review. The judge *machinery* is sound: structured per-criterion
verdicts, and an adversarial check (deliberately wrong answers) failed all three correctly —
v3-decoy and dist-artifact → `pass=false` + `material_error=true`; "treeifyError is flat" → the two
content facts fail **but the correct sub-fact still passes** (genuine per-criterion discrimination).
**But** every *real* run was correct (§Finding 1), so the judge's false-pass/false-fail rate on
*ambiguous* answers is unmeasured — and design §6 requires ≥20% stratified human double-label with
reported agreement. With 100% pass there is no discrimination data. Honest answer: **the judge works
mechanically; its agreement rate is not yet measurable and must be established on a task set that
actually produces wrong answers.**

### (c) Variance + affordable N? — **DATA COLLECTED, but the sized contrast is confounded**
Per-cell token stdev (now sample/Bessel) ranges wide; the rough required-N (claude ≈ tens, codex ≈
tens per condition) is **not trustworthy** because it sizes a conflated, order-confounded token total
(see Finding 2 + review H2/B3). Re-size only after the Phase-B fixes.

---

## Efficiency results — per component (design §5: never one opaque total)

Mean tokens per (model, rung). The single "total" is a **trajectory-length proxy**, not cost.

| model · rung | uncached | cache_write | cache_read | output | total (proxy) |
|---|---|---|---|---|---|
| claude naive | 10 | 3,668 | 96,171 | 1,236 | 101,085 |
| claude discipline | 87 | 6,500 | 121,454 | 2,091 | 130,132 |
| claude full | 91 | 7,363 | **178,300** | 2,349 | 188,103 |
| codex naive | 33,808 | — | 184,548 | 1,282 | 219,858 |
| codex discipline | **37,881** | — | 162,532 | 1,576 | 202,335 |
| codex full | **35,292** | — | **213,646** | 1,710 | 251,069 |

**What the opaque total hid (review B3):** the naive→full growth is almost entirely **cache_read** —
the cheapest component (~10% of uncached-input price). Codex **uncached input actually falls**
discipline→full (37.9k → 35.3k); its inflation is purely cache_read (more turns re-reading a longer
cached context). So "+86% / +14%" overstates the real picture.

**Cost-weighted (claude, Opus prices):** naive $0.31 · discipline $0.46 · full $0.58 — full is still
~2× naive in dollars (cache_read volume + output + cache_write), so a *real* full-rung cost premium
exists **for claude**; for codex it is much weaker once components are separated. Correctness:
**54/54 pass (100%).**

---

## Critical findings

### Finding 1 — Correctness does not discriminate (task set too easy)
54/54 pass; even naive cited `v4/classic/coerce.ts` and avoided the v3 decoy, so `material_error`
never fired on a real run (the gate is wired + adversarially verified, just never triggered). The
pilot therefore **cannot size correctness non-inferiority** — no variance. Phase B needs harder /
negative / decoy tasks across ≥4 deps so weaker approaches actually fail.

### Finding 2 — The `full` token premium: doc-reading is a *plausible contributor*, not proven to dominate
Softened after review (H6). One out-of-band re-run of a `codex/full` cell showed the agent read ~700
lines of external refs skill docs (`SKILL.md` + `investigate.md`) before using refs (correctly, exit
0, grounded). That plausibly inflates tokens — **but** it is n=1, not from the 54 measured runs
(transcripts weren't persisted — now fixed), the claude side is unexplained, and the cache_read-shaped
growth is consistent with "more turns from *any* cause" (doc-reading, the `refs list` discovery step
`full.md` forces, refs JSON volume, or plain trajectory lengthening). It remains a real confound
vs design §3 rung-2/3 equivalence; the fix (below) must be symmetric across rungs.

### Finding 3 — Transcript persistence (FIXED)
`runOne` dropped `runCell`'s `raw`, so Finding 2 could only be diagnosed by re-running. Now the record
persists `raw`, a derived `tool_calls` count, `started_at`, `code`, and `failed`.

---

## Review-driven fixes **applied on this branch** (commit `e8e7fc7`)
- **Scoring fail-open (Codex#1/Fable B2):** the judge must now grade *every* critical fact by identity
  and pass all; a `judge_complete` flag fails runs where the judge graded too few.
- **Judge contract contradiction (Codex#2/B2):** `JUDGE_PREAMBLE` now includes `material_errors`,
  matching `buildJudgePayload`.
- **Codex reasoning double-count (Codex#7/B3):** visible output = `output_tokens − reasoning`.
- **Sample stdev (Fable M2):** `stdev` is now Bessel (÷ n−1), 0 for n≤1.
- **Timeouts/CLI errors as failures (B1):** `runCell` surfaces `code`/`failed`; non-zero exit no
  longer parsed as a success; `analyze` reports the failed/timed-out count.
- **Claude pinning + read-only (Codex#8/#9/H3):** `--model claude-opus-4-8` + `--disallowed-tools
  Write Edit NotebookEdit`.
- **Neutral judge cwd (Fable H3):** the judge runs in `os.tmpdir()`, not the checkout.
- **Randomized cell order (Codex#5/Fable H2):** seeded Fisher–Yates (recorded seed) breaks the fixed
  naive→discipline→full sequence.
- **Commit stamping (Codex#3/Fable H1):** each ref's HEAD is recorded per run; a drift from
  `task.commit` warns loudly.
- **Per-component analysis (Fable B3):** `analyze` prints component means, labels the total a proxy.
- **UTF-8 decode (Fable M6):** `spawnExec` sets `utf8` encoding (no multi-byte corruption).

## Still open for Phase B (need a re-run + design work — your call)
1. **De-confound rung 3 fully** — self-contained `full.md` + hide the external skills dir for **all**
   rungs (symmetry), so the measured effect is the refs-command effect. Also remove `refs` from the
   control rungs' PATH (naive/discipline can currently reach it).
2. **Discriminating task set** — harder/negative/decoy tasks across **≥4 deps**; re-estimate N after.
3. **Two-pass persist-then-score (Fable H4)** so a judge crash never discards an expensive answer.
4. **Cost-weighted aggregate as primary** (date-stamped prices) with per-component tables (§8).
5. **Judge-agreement calibration** — ≥20% human double-label once wrong answers exist (§6).
6. **From the skill-eval review:** holistic/pairwise quality judge; a separate trigger eval for the
   SKILL.md `description`; prune non-discriminating `critical_facts` after a real run.

**refs-skill improvements surfaced (independent of the bench):** tighten the `SKILL.md` description
(implicit-trigger clause + negative boundary); consolidate a `## Gotchas` block (hoist blobless
cold-fetch + "tags can lie"); add a progress checklist to `add.md`.

---

## Bottom line
Mechanics: **validated** (and hardened against the review). Efficiency: a **real full-rung cost
premium for claude**, but cache_read-shaped and its cause not yet isolated; **weaker for codex**.
Correctness non-inferiority: **un-sizable from this pilot**. Both reviewers converge on
**GO-conditional**: build the Phase-B harness, but land the open fixes (esp. rung-3 de-confounding,
a discriminating ≥4-dep task set, two-pass scoring) and re-run before any efficiency/correctness claim.
