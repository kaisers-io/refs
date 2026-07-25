# Source-access pilot — findings

**Run:** `results/2026-07-25T07-14-47.995Z.jsonl` · 108 cells · 0 errors · seed 7 · repeats 3.
Design: [issue #16](https://github.com/kaisers-io/refs/issues/16). Harness: `README.md`.
**Screening-grade** — a directional read, not a citable effect size. Do not over-quote.

## Headline

Giving the agent the **real dependency source** (refs) roughly **doubled** answer correctness
on source-requiring questions, and the effect **survived the negative control**.

| Arm | Cells passing | Pass rate |
| --- | --- | --- |
| **no-source** (A0) | 20 / 54 | **37%** |
| **refs** (B) | 47 / 54 | **87%** |

Paired by item × model (7 items × 2 models, majority of 3 repeats):

- **refs-wins 9 · no-source-wins 0 · both 4 · neither 1** → of the 9 decisive scored pairs,
  **refs won 100%**. There is no item where no-source beat refs.

## The controls are what make it credible

- **NC1 (source should NOT help)** — "how do `.parse()` and `.safeParse()` differ?": **both arms
  pass** (no-source 1.00 both models). The harness does **not** blindly reward refs; where the
  answer is common documented knowledge, no-source matches it. This is the key check that the
  87-vs-37 gap is a real source effect, not a scoring artifact or pro-refs judge bias.
- **NC2 (genuinely unanswerable)** — "what maintainer reason is recorded for X?": **refs wins both
  models.** With source, the model correctly said the rationale is *not recorded*; without source it
  failed (invented or asserted one). So source access also made the model **more honest about what
  the source does not establish** — a qualitative win beyond raw correctness.

## What the item-level pattern confirms

- **Contamination flags were vindicated.** The two items pre-flagged as guessable landed in "both":
  P1 (catch-on-absent-key — the fixed behavior is the *intuitive* behavior) and P4/codex (cidrv6 —
  "compressed IPv6 should validate" is an easy normative guess). The harness distinguishes
  guessable items from genuinely source-requiring ones.
- **Source-requiring items separated cleanly:** P3 (transient-commit behavior), P5/P6 (iso
  refactor internals + recorded rationale), P2 (internal `fallback` field) — strong refs-wins.
- **Weak spot:** P2/codex (refs 0.33 across 3 repeats) — the hardest internal-mechanism item;
  GPT-5.6 *with* source still got it inconsistently. Claude/refs got P2 at 1.00. Model-dependent.
- **Leakage check:** 0 / 54 no-source answers cited real `path:line` or claimed to read the
  source — the no-source failures are genuine, not secret source access.

## Honest caveats (screening-grade)

- No confidence intervals; raw discordance only. Opposite-family judge (pilot-grade), not a third
  family — though NC1 passing argues against a systematic pro-refs judge bias.
- CU1 items (P1/P2/P3) share one change-unit → **~7 independent scored units**, not 9.
- No egress sandbox; the no-source arm was *told* not to fetch (leakage would only *shrink* the gap,
  so a positive is conservative — and the leakage check came back clean).
- N is small; one prompt style; within-model comparison. zod only (payload/kysely not yet run).

## Verdict

For the decision "is refs worth it?" the screening answer is **yes**: real source access
roughly doubled correctness on questions that require it (37% → 87%), won every decisive pair, and
correctly showed **no** advantage on the control question while improving honesty on unanswerable
ones. This clears the gate to the rigorous confirmatory study (A0/A1/B, third-family judge,
sandbox, CIs, 3 deps) **if** a citable effect size is wanted. It is not itself that citable number.
