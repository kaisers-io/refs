# Pilot findings + go/no-go

**Run:** 2026-07-23, N=3 · 54 cells (3 tasks × 2 models × 3 rungs × 3 repeats) · 0 errored.
**Scope:** mechanics validation only (per `bench-design.md` §2/§12) — NOT a test of the efficiency
claim itself. All numbers are within-model; cross-model token counts are not comparable.

## Recommendation: **GO on mechanics — CONDITIONAL on two design fixes before the full study**

The measurement machinery works end-to-end (telemetry, orchestration, deterministic + blinded
cross-family judge, material-error scoring, variance/power). The harness is buildable as specified.
**But the pilot surfaced two issues that make the current efficiency/correctness contrasts
un-provable as-is** — both must be fixed before Phase B produces a defensible claim. This is exactly
what a pilot is for.

---

## The three go/no-go questions (design §12)

### (a) Cache-separated per-run telemetry from both CLIs? — **YES**

- **Claude** (`claude -p --output-format json`): fully cache-separated —
  `input_uncached / cache_write / cache_read / output`, `reported=false`. 27/27 runs clean.
- **Codex** (`codex exec --json`): `input_uncached` (derived) `/ cache_read / output / reasoning`;
  **no cache-write component** → `reported=true` with that documented exclusion. 27/27 runs clean.
- 0/54 runs failed telemetry extraction. The text-volume-proxy fallback is **not** needed.

### (b) Does the atomic-fact judge agree with humans? — **YES (on the cases available)**

- The judge returns real structured per-criterion verdicts (2/2, 3/3), not empty or holistic.
- On all human-spot-checked **correct** answers it agreed (passed genuinely-correct answers).
- **Adversarial discrimination check** (deliberately wrong answers) — the judge correctly failed all:
  - "cites v3/types.ts as the zod-4 answer" → `pass=false`, `material_error=true`, both facts fail.
  - "coerce is in dist/index.js" → `pass=false`, `material_error=true`.
  - "treeifyError returns a flat list" → the two content facts fail **but the correct sub-fact
    (names core/errors.ts) still passes** → genuine per-criterion discrimination, not blanket reject.
- **Caveat:** because every real run was correct (see below), the judge's false-pass/false-fail rate
  on _ambiguous_ real answers could not be measured. That calibration needs correctness variance,
  which the pilot task set did not produce.

### (c) Variance + affordable N? — **DATA COLLECTED, but the contrast is confounded (see Finding 2)**

- Repeat variance is **high and heterogeneous**: per-cell token stdev ranged **27 → 100,987**.
- Rough required-N (normal-approx placeholder) for the Full-vs-Discipline token contrast:
  **claude ≈ 31/condition, codex ≈ 18/condition.** These are **not trustworthy** because the token
  contrast they size is confounded by Finding 2.

---

## Efficiency results (within-model, mean total native tokens)

| model  | naive   | discipline     | full                        | wall naive→full |
| ------ | ------- | -------------- | --------------------------- | --------------- |
| claude | 101,085 | 130,132 (+29%) | 188,103 (**+86%** vs naive) | 22.6s → 40.2s   |
| codex  | 219,858 | 202,335 (−8%)  | 251,069 (**+14%** vs naive) | 51.0s → 58.2s   |

**The token trend runs BACKWARDS from the hypothesis: `full` (with refs) costs MORE, not less.**
Correctness: **54/54 pass (100%) in every cell.**

---

## Critical mechanics findings (the real pilot payload)

### Finding 1 — Correctness does not discriminate (task set too easy)

Every rung, both models, passed all three tasks — even **naive** correctly cited `v4/classic/coerce.ts`
and **avoided the v3 decoy** (so `material_error` never fired on real runs). Consequence: the pilot
**cannot size the correctness non-inferiority test** — there is no variance to power it. The full
study needs harder, negative, and decoy-heavy tasks across ≥4 deps so that weaker approaches actually
fail. Corollary: the `material_errors` scoring is wired and verified (via the adversarial check) but
was never exercised by a real run.

### Finding 2 — Token inversion is a **skill-doc confound**, not a refs-command cost

Diagnosed by re-running one `codex/full` cell with the transcript kept (the results don't persist it
— Finding 3). The `full`-rung agent:

- **used refs correctly** (`refs list`, `refs search … --json`; exit 0; grounded in git-grep + real
  file reads), but
- **first autonomously read ~700 lines of external refs skill docs** —
  `sed -n '1,240p' …/.agents/skills/refs/SKILL.md` and `…/references/investigate.md` — before doing
  any work.

That doc-reading dominates `full`'s token cost and **confounds the design's §3 rung-2/3 equivalence**
(rung 3 should differ from rung 2 by the refs-command _mechanism only_, not by pulling in the whole
investigate.md playbook). Launch isolation blocks _auto_-loading the skill, but the agent reads the
files manually because the preamble names `refs`. **Fix before Phase B:** make `full.md` fully
self-contained (inline everything the agent needs about `refs search`/`refs range`) **and** prevent or
separately account for external skill-doc reads (e.g. run rung 3 with the skills dir hidden), so the
measured effect is the refs-command effect — not the cost of reading documentation. High, bimodal
variance (stdev up to ~101k) is consistent with "sometimes reads all docs, sometimes not."

### Finding 3 — No transcript persistence (blocks post-hoc diagnosis)

`runOne` records answer + telemetry + score but **drops `runCell`'s `raw`**, so Finding 2 could only
be diagnosed by re-running. Phase B must persist the raw transcript + a tool-call count per run
(also flagged by the skill-eval review). Cheap and high-value.

---

## Recommendations for the full study (Phase B)

**Must-fix (block the causal claim otherwise):**

1. **De-confound rung 3** — self-contained `full.md` + hide/measure external skill-doc reads.
2. **Discriminating task set** — harder / negative / decoy tasks across **≥4 deps** so correctness
   varies and non-inferiority can be sized. Re-estimate N only after Findings 1–2 are fixed.
3. **Persist transcripts + tool-call counts** per run.

**From the agentskills.io skill-eval review (methodology add-ons, mostly Phase B):**

- Add a **holistic/pairwise quality judge** (citation quality, conciseness) beside the fact grader —
  atomic pass/fail can't see the qualities that justify refs' token cost.
- Add a separate **trigger eval** (~20 queries, near-miss negatives) for the SKILL.md `description` —
  the bench injects the playbook directly and never tests whether the skill _loads_.
- After a real run, **prune non-discriminating `critical_facts`** and diversify beyond zod.

**refs-skill improvements surfaced (independent of the bench):** tighten the `SKILL.md` description
with an implicit-trigger clause + a negative boundary; consolidate a `## Gotchas` block (hoist the
blobless-cold-fetch + "tags can lie" gotchas into SKILL.md); add a progress checklist to `add.md`.

---

## Bottom line

Mechanics: **validated.** Efficiency claim: **currently un-proven and confounded** (Finding 2).
Correctness non-inferiority: **un-sizable from this pilot** (Finding 1). Proceed to build the reusable
Phase-B harness, but land Fixes 1–3 first — otherwise the full study would inherit the same confounds.
This matches the design's honest fallback: without the fixes, efficiency stays "reported, confounded"
and correctness stays "exploratory," not proven.
