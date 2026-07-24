# refs Efficiency Benchmark — Phase B report

**Status:** harness built, reviewed, smoke-validated, and **the dev-scale grid RAN**
(run-id `2026-07-24T05-59-32.564Z`, N=3, 324 answer cells + 324 judge calls). This report
documents the de-confounded harness, the grid results, and the honest caveats. It is
deliberately a **decision-grade engineering signal, not a preregistered causal study** (see
Limits).

**Date:** 2026-07-24 · **Branch:** `bench/phase-b` (off `main`) · Pilot findings:
[`bench/pilot/FINDINGS.md`](./FINDINGS.md).

**Headline (read this first):** across all 324 cells, **neither model invoked `refs` on a
single task** (adoption = 0/324, measured via the logging shim). Given a `full`-rung preamble
that teaches `refs search`/`range` inline, both Opus 4.8 and GPT-5.6 answered every task via
git / grep / file reads instead. So the `full` rung reduces to *"discipline preamble + unused
refs teaching"*, and the engineering answer — **does adding `refs` cut cost-weighted cost on
search/range high-burden tasks, within these 3 deps** — is, under **intent-to-treat**, **no**:
the added preamble is a net cost (clearly for Claude; noisy/null for Codex), with no offsetting
adoption to pay it back. A null/negative effect driven by non-adoption is a real finding, not a
harness fault — and it is the single most useful thing this grid tells us.

---

## What Phase B set out to fix (from the pilot)

The pilot ([`FINDINGS.md`](./FINDINGS.md)) validated the measurement machinery but showed the
efficiency/correctness contrasts were **not yet provable**: rung 3 was confounded (agents read
~700 tokens of external refs skill docs), the task set was too easy (54/54 pass, no discrimination),
scoring could drop expensive answers on a judge crash, prices were stale, and there was no
"where does refs help" axis. Phase B addresses each **de-confoundably**, and **measures** the
residual confounds instead of claiming them absent.

## The de-confounded harness (Tasks 1–7)

| # | Change | Why it matters |
|---|--------|----------------|
| 1 | **Self-contained `full.md`** — the rung-3 preamble teaches `refs search`/`range` inline (worked `--json` examples), with no reference to external skill docs. | Removes the *need* to read external docs, the pilot's biggest rung-3 confound. Worked examples use a neutral, non-answer range so they can't leak a task's answer. |
| 2 | **Full-only `refs` shim + per-rung compliance logging.** `basePath` = ambient PATH minus the refs dir, so control rungs **provably cannot resolve `refs`**; the `full` rung reaches it only through a logging shim. Each run records `refs_on_path` and every `refs` invocation. Judge tightened (`--tools ""`, read-only, neutral cwd). | Isolation is **verified per run**, not assumed. The shim is also what let us **measure adoption = 0** (below). |
| 3 | **Two-pass run→score + provenance + integrity hard-fails.** Pass A writes immutable `raw.jsonl` (answers+telemetry+compliance) + a provenance `manifest.json`; Pass B judges into `scored.jsonl`, retaining every record. The run **hard-fails** on checkout commit drift and on any compliance violation. | A judge crash never discards a paid answer — **Pass B is re-runnable against the immutable answers**, which is exactly what saved this grid when two scoring bugs surfaced (below). The manifest pins harness commit, per-task checkout HEADs, CLI versions, seed, preamble hashes. |
| 4 | **Failure policy + TTL-aware pricing.** `classifyRun` separates `pass`/`fail`/`measurement_error`; a **timeout is a correctness fail but a cost-censored observation**. Verified current list prices (Opus 4.8, GPT-5.6, verified 2026-07-23), TTL-split cache-write. | Cost is honest: codex cost is labeled an **API-list-price-equivalent lower bound** (no cache-write telemetry), distinct from subscription spend. |
| 5 | **Corpus across 3 deps with `tool_target` + measured burden** (zod, payload, next.js — 18 tasks). Each task carries an **outcome-blind** `tool_target ∈ {search, range, neither}` and an objectively **measured** retrieval burden. | The "where does refs win" axis, with a high-burden search/range group and a `neither` control group, and discriminating rubrics (real decoys as `material_errors`). |
| 6 | **Trajectory metrics** (`turns`, `tool_calls`, `tool_output_bytes`) + runner pins (`--effort medium`, `--no-session-persistence`, `--no-chrome`). | Matches the claim's "and speed". Honest: claude `tool_calls` are `n/a` (no tool trace in `-p json`). |
| 7 | **Descriptive analyzer** — per-component + **cost-weighted** means (primary headline), pass/failure/measurement-error rates, refs-compliance, and the **Full − Discipline cost delta split by `tool_target` × burden tertile** with bootstrap CIs. | The deliverable table. Labeled descriptive; CIs are for transparency, not a powered interaction test. |

All gates green; each task cross-reviewed. 118 harness tests pass (was 111; +2 regression tests
for the scoring bugs below, +5 since).

---

## The grid run (what ran)

- **run-id:** `2026-07-24T05-59-32.564Z` · **seed** 1 · **N = 3 repeats**.
- **Grid:** 18 corpus tasks × 3 rungs (naive / discipline / full) × 2 models × N=3 = **324
  answer cells**, each judged cross-family = **324 judge calls**.
- **Models (pinned):** Claude answers `claude-opus-4-8` `--effort medium`; Codex answers
  `gpt-5.6-sol` `model_reasoning_effort=medium`. Cross-family judge (Claude answers judged by
  Codex, and vice-versa).
- **Provenance (`manifest.json`):** answer pass ran on **harness commit `75f2b1e` (clean tree)**;
  CLI versions **claude `2.1.218`, codex `0.144.6`**; pricing **verified 2026-07-23**; per-rung
  preamble hashes pinned. **All integrity hard-fails passed** (per-task checkout commits matched;
  no compliance violation).
- **Answer pass:** 324/324 cells, **0 failures, 0 timeouts, 0 measurement errors.**

### Two scoring-pass bugs found in the re-score (and fixed)

The immutable answer pass was clean, but the **first** score pass surfaced two Pass-B defects that
corrupted the correctness axis. Because Pass B re-runs against the immutable `raw.jsonl` (no
re-answer, no re-spend on the expensive model answers), both were fixed and the grid re-scored
(harness commit **`7c50bd9`**):

1. **Cross-family Codex judge exited 1 in the neutral non-git tmpdir** (`Not inside a trusted
   directory and --skip-git-repo-check was not specified`), returning an empty answer → **every
   Claude-answer verdict fail-closed** (`judge_complete=false`, 153/162). Fix: add
   `--skip-git-repo-check` to the codex isolation flags (a no-op inside the git checkouts the
   answer pass uses).
2. **A deterministic regex with a leading `(?i)` inline-flag group** (one task,
   `next-symlink-nft-negative`) made `new RegExp(pattern,'u')` throw → `score_error` silently
   dropped 18 cells. Fix: `score.mjs` now lifts a leading inline-flag group into real JS flags.

Both have regression tests. This is exactly the failure mode the two-pass split was built to
survive: a scoring bug never costs a paid answer.

---

## Results

### 1. Adoption (intent-to-treat): 0/324

The shim logged **zero `refs` invocations across all 324 cells** — including all 108 `full`-rung
cells, where `refs` was provably on PATH (`refs_on_path`=shim for every full cell; empty for every
control cell). **Compliance leak = 0%** on both models' control rungs. So the `full`−`discipline`
contrast below measures **the cost of the refs-teaching preamble that the models did not act on**,
not the cost/benefit of *using* `refs`. Everything downstream is read through that lens.

### 2. Cost-weighted spend per (model, rung) — the primary headline

Cost-weighted native-token spend (the headline; summed tokens are only a trajectory proxy):

| model | rung | cost-weighted mean | pass rate |
|-------|------|--------------------|-----------|
| **Claude** (Opus 4.8) | naive | **$0.0828** | 89% |
| | discipline | **$0.0981** | 98% |
| | full | **$0.1164** | 87% |
| **Codex** (GPT-5.6) `[LOWER BOUND]` | naive | **$0.3037** | 67%¹ |
| | discipline | **$0.3396** | 65%¹ |
| | full | **$0.3227** | 76%¹ |

- **Claude (complete cost accounting):** cost rises **monotonically** naive → discipline → full
  ($0.083 → $0.098 → $0.116). `full` is **+$0.018 (+19%) over discipline** and **+$0.034 (+41%)
  over naive** — the longer preamble is pure cache-read cost, and with `refs` never invoked there
  is nothing to earn it back.
- **Codex (lower-bound cost):** noisier and cache-read-dominated (naive $0.304, discipline $0.340,
  full $0.323); `full` is nominally *below* discipline but the ordering is within run-to-run
  cache-read variance and the figure is a **lower bound** (no cache-write telemetry).
- **Cross-model USD is not comparable** as an apples-to-apples number: Codex is an
  API-list-price-equivalent **lower bound** on a different basis. Token/cost comparisons are
  **within-model only**.

¹ Codex pass rates are **deflated ~20%** — see §4.

### 3. "Where refs would win" → Full − Discipline preamble-cost delta

The analyzer's `tool_target × burden` table is labeled "where does refs win", but **since `refs`
was never invoked, it does not measure refs**; it measures where the *preamble* was cheap or dear.
Read that way (negative = `full` cheaper):

- **Claude — every stratum is positive** (full costs more), search/range/neither alike
  (+$0.007 … +$0.033 per task; per-dep: payload +$0.029, zod +$0.016, next +$0.010). A clean,
  consistent "the refs preamble is a net cost, uniformly."
- **Codex — mixed and noisy** (lower bound): range-target cells show `full` nominally cheaper
  (range low −$0.066, med −$0.073, high −$0.164) and per-dep next −$0.052 / zod −$0.038, but most
  tertile CIs cross zero, task counts are 1–2 per cell, and **with `refs` uninvoked none of this
  is attributable to `refs`** — it is cache-read variance in a lower-bound measure, not a retrieval
  win.

**So the "does refs win on search/range high-burden" question resolves to: not observed — because
the tool was not adopted.** The infrastructure to detect a win is in place and verified (isolation
0% leak, burden strata, CIs); there was simply no treatment uptake to detect.

### 4. Correctness (pass rates)

- **Claude answers: fully judged (162/162 complete verdicts), and discriminating** — naive 89% /
  discipline 98% / full 87%. High but not saturated (unlike the pilot's 100%); the rubric's
  `material_errors` do bite. A hand spot-check of pass/fail verdicts on `payload-aftervalidate-
  negative` confirmed the judge grades sensibly (same task, two repeats, one pass / one fail on a
  genuinely weaker answer).
- **Codex answers: pass rate is deflated by residual judge incompleteness.** After the fix,
  32/162 Codex cells (20%) still got an **incomplete** verdict from the Claude-as-judge (it
  occasionally returns fewer graded facts than the rubric lists) → fail-closed. Among the 130
  fully-judged Codex cells, **pass = 86% (112/130)**, versus the 65–76% shown in the table.
  A spot-checked incomplete cell (`payload-committransaction-noop-default`) had a *plausibly
  correct* answer that was fail-closed purely on the empty verdict — so **Codex correctness is
  meaningfully better than the raw per-rung rates suggest.** Treat Codex pass rates as a lower
  bound; the Claude-answer correctness axis is the clean one.
- **No timeouts, no measurement errors, 0% compliance leak** on either model.

### 5. Trajectory (speed proxy)

| model | rung | wall | turns | tool_calls | tool_bytes |
|-------|------|------|-------|-----------|-----------|
| Codex | naive / discipline / full | 49.5s / 64.8s / 53.8s | 3 / 4 / 3 | 6 / 8 / 7 | 37k / 96k / 73k |
| Claude | naive / discipline / full | 21.0s / 27.6s / 28.3s | 4 / 4 / 6 | n/a² | n/a² |

² Claude `tool_calls`/`tool_bytes` have no trace in `-p json` — rendered `n/a`, never 0. Both
models take *more* turns/wall on the longer rungs, consistent with §2 (the preamble adds work, not
saves it).

### The engineering answer

**Within these 3 deps, at N=3, adding a `refs`-teaching rung did not reduce cost-weighted cost on
search/range high-burden tasks — because neither Opus 4.8 nor GPT-5.6 adopted `refs` when offered
it inline.** The added preamble is a net cost (clear and monotonic for Claude; noisy/null and
lower-bound for Codex). The isolation, burden strata, and CI machinery all held; the missing
ingredient was treatment uptake. **The actionable signal is about adoption, not retrieval
efficiency:** a `refs` rung only pays off if the agent actually calls `refs`, and here — with a
purely inline, opt-in teaching preamble and capable git/grep fallbacks — it never did.

---

## Limits (read before quoting any number)

- **Adoption was 0 → this is an intent-to-treat null, not a "refs doesn't help retrieval" result.**
  The grid cannot say whether `refs` *would* cut cost when actually invoked; it says the models
  did not invoke it under this preamble. A treatment-on-the-treated estimate needs cells where
  `refs` is actually called (e.g. a preamble that mandates it, or a task git/grep can't answer).
- **Descriptive, not confirmatory.** Every efficiency number is descriptive; bootstrap CIs are for
  transparency, not a powered significance/interaction test.
- **Correctness non-inferiority is not powered**, and **Codex pass rates are a lower bound** — the
  Claude-as-judge returns an incomplete verdict ~20% of the time and those fail-closed. Judge-
  completeness/agreement calibration is descoped; the Claude-answer axis (0% incomplete) is the
  trustworthy one. Two earlier scoring bugs were found and fixed (above) before these numbers.
- **Isolation is measured, not guaranteed.** Controls provably can't resolve `refs` via PATH
  (verified 0% leak per run), but an absolute-path invocation of the real binary would bypass the
  shim's log (bounded, not eliminated). Here it is moot: 0 invocations of any kind.
- **Codex cost is a lower bound** (no cache-write telemetry). Cross-model USD is date-stamped and
  labeled; token comparisons are **within-model only**.
- **3 deps ≠ population inference.** The analyzer surfaces per-task and per-dep deltas so the
  spread is visible; any aggregate CI assumes task independence.
- **Cache carryover not eliminated** (within-block randomization only).
- **Corpus is subagent-authored + controller-spot-verified**, and **frozen in this PR (the "seal")**.
  Negative-task deterministic regexes are intentionally permissive; discrimination lives in
  `material_errors`, which the grader weights.

**What a full *causal* study would additionally require** (deliberately out of scope; see the
archived v2 plan + Codex reviews): preregistration + external-custody held-out corpus; a named
exact paired-binomial non-inferiority test + power simulation; an allowlisted-runtime sandbox with
a bypass matrix; Williams counterbalancing / cold-start estimand; a multiplicity-controlled
confirmatory family; ≫4-dep population inference; **and a treatment arm that actually induces
`refs` use.** The conclusion here holds at the decision-grade bar, not the publishable-causal bar.

Any product or marketing claim from these results remains a human decision.
