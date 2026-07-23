# refs Efficiency Benchmark — Phase B report

**Status:** harness built and reviewed (Tasks 1–7), end-to-end pipeline **smoke-validated on the
real CLIs**. The **full dev-scale grid run is deferred pending a budget/N decision** — this report
documents the de-confounded harness, what the smoke proved, and exactly what the grid will produce.
It is deliberately a **decision-grade engineering signal, not a preregistered causal study** (see
Limits).

**Date:** 2026-07-24 · **Branch:** `bench/phase-b` (off `main`) · Pilot findings:
[`bench/pilot/FINDINGS.md`](./FINDINGS.md).

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
| 2 | **Full-only `refs` shim + per-rung compliance logging.** `basePath` = ambient PATH minus the refs dir, so control rungs **provably cannot resolve `refs`**; the `full` rung reaches it only through a logging shim. Each run records `refs_on_path` and every `refs` invocation. Judge tightened (`--tools ""`, read-only, neutral cwd). | Isolation is **verified per run**, not assumed. Honest residual: the log catches PATH-mediated calls; an absolute-path call to the real binary would bypass it (bounded by the self-contained preamble + persisted transcripts — for codex the JSONL transcript shows tool calls, for claude `-p json` it does not). |
| 3 | **Two-pass run→score + provenance + integrity hard-fails.** Pass A writes immutable `raw.jsonl` (answers+telemetry+compliance) + a provenance `manifest.json`; Pass B judges into `scored.jsonl`, retaining every record. The run **hard-fails** on checkout commit drift and on any compliance violation (a control resolving `refs`, or `full` missing the shim). | A judge crash never discards a paid answer (Pass B is re-runnable). The manifest pins harness commit + dirty flag, per-task checkout HEADs + peeled tags, CLI versions, seed, preamble hashes, pricing date. |
| 4 | **Failure policy + TTL-aware pricing.** `classifyRun` separates `pass`/`fail`/`measurement_error`; a **timeout is a correctness fail but a cost-censored observation** (cost is never imputed). Verified current list prices (Opus 4.8, GPT-5.6), TTL-split cache-write, completeness flags. | Cost is honest: `costWeighted` never silently zeroes/undercounts; codex cost is labeled an **API-list-price-equivalent lower bound** (no cache-write telemetry), distinct from subscription spend. |
| 5 | **Corpus across 3 deps with `tool_target` + measured burden** (zod, payload, next.js — 18 tasks). Each task carries an **outcome-blind** `tool_target ∈ {search, range, neither}` and an objectively **measured** retrieval burden (search construct: grep hits / files / bytes; range construct: commit count / changed paths / diff size — never combined). | The "where does refs win" axis. Covers all six job types, both a high-burden search/range group and a `neither` control group, with discriminating rubrics (real decoys as `material_errors`). |
| 6 | **Trajectory metrics** (`turns`, `tool_calls`, `tool_output_bytes`) + runner pins (`--effort medium`, `--no-session-persistence`, `--no-chrome`). | Matches the claim's "and speed". Honest: claude `tool_calls` are `n/a` (no tool trace in `-p json`), never rendered as 0. |
| 7 | **Descriptive analyzer** — per-component + **cost-weighted** means (primary headline), pass/failure/measurement-error rates, refs-compliance (measured control-rung leakage), and the **Full − Discipline cost delta split by `tool_target` × burden tertile** with bootstrap CIs. | The deliverable table. Labeled descriptive; CIs are for transparency, not a powered interaction test; task-level bootstrap assumes task independence. |

All gates green; each task cross-reviewed (internal reviewer, several with a Codex cross-model pass
folded in). 111 harness tests pass.

---

## Smoke validation (4 real cells — pipeline, not an efficiency finding)

A minimal paid smoke ran **1 sentinel task (`zod-4-parser-range`) × 2 models × {full, naive} × 1
repeat = 4 cells** (+ 4 judge calls), to prove the pipeline works on the real CLIs before the grid.
**These numbers validate mechanics only — n=1 per cell on one sentinel task is not an efficiency
signal, and the sentinel set is permanently excluded from the analytic corpus.**

What the smoke confirmed:

- **Isolation works on the real setup:** pre-flight reported `refs on PATH: full=<shim> naive=(none)`.
  Per-run compliance: `naive` rungs had `refs_on_path=no`; `full` rungs had `refs_on_path=yes` (the
  shim). Both integrity hard-fails passed (commit match, no compliance violation).
- **Telemetry captured, cache-separated, valid** for all 4 cells (0 extraction failures); commit
  provenance matched the pinned SHA; `manifest.json` written with a clean-tree flag.
- **Behavioral observation (intent-to-treat):** on this task, **both `full`-rung agents answered via
  git without invoking `refs`** (`refs_calls = 0`), while the longer `full` preamble still cost more
  input/cache than `naive`. This is exactly the "full premium, refs not adopted" pattern the pilot
  flagged — real data the grid will quantify, not a harness fault. (The shim's logging path is unit-
  verified separately; here there was simply nothing to log.)
- **Two-pass + scoring** ran end-to-end: Pass A → `raw.jsonl`, Pass B judged → `scored.jsonl`, and the
  analyzer rendered its tables from the scored file.

The analyzer rendered every section from the scored file. Excerpt (n=1 per cell — **not** a
signal):

```
===== codex =====
  naive  n=1 | ... cache_read=45568 output=290 reasoning=138 | cost=$0.1677 [LOWER BOUND]
        pass=0% fail=100% measurement_error=0% timeout=0%
  full   n=1 | ... cache_read=164352 output=1051 reasoning=438 | cost=$0.3133 [LOWER BOUND]
        pass=100% fail=0% measurement_error=0% timeout=0%
refs-compliance (control rungs): codex leak=0%
trajectory: codex/naive turns=2 tool_calls=2 tool_bytes=10310 · codex/full turns=2 tool_calls=6 tool_bytes=21472
===== claude =====
  naive  n=1 | input_uncached=6  cache_write_1h=35609 cache_read=17559 output=646 | cost=$0.3810
  full   n=1 | input_uncached=10 cache_write_1h=22528 cache_read=78537 output=980 | cost=$0.2891
refs-compliance (control rungs): claude leak=0%
trajectory: claude/naive turns=3 tool_calls=n/a · claude/full turns=5 tool_calls=n/a
```

Three honest observations from the smoke (all are *mechanics*, not efficiency findings):

- **Compliance leak = 0%** on both models' control rungs — the PATH isolation held on the real setup.
- **Scoring discriminates** (unlike the pilot's 100% pass): codex/full passed; codex/naive failed a
  deterministic check; **both claude cells fail-closed because the cross-family (codex) judge returned
  an incomplete verdict** (`judge_complete=false`) — the anti-fail-open discipline working as designed.
  This flags a real risk for the grid: **judge completeness/reliability affects observed pass rates**
  (judge-agreement calibration is descoped — see Limits). Worth a human eye during the grid.
- **The "Full − Discipline" delta table is empty here** because the smoke deliberately used
  `{full, naive}` (to test shim-vs-isolation), not `discipline`. The delta needs discipline cells; it
  populates on the full grid (all three rungs) and its computation is unit-tested with a planted
  per-stratum difference (Task 7).

---

## The grid run (deferred — needs a budget/N decision)

The analytic grid is **~18 tasks × 3 rungs × 2 models × N repeats**. At **N = 3** that is **324 answer
cells + 324 judge calls ≈ 648 paid CLI invocations** (Opus 4.8 + GPT-5.6). The smoke cells ran roughly
10k–200k tokens each; a rough order-of-magnitude estimate is single-digit to low-tens of dollars at
N = 3, but **this should be confirmed against the pre-flight print** (`run.mjs` prints the exact cell
and invocation count and the pinned CLI versions before any paid call).

To run it tomorrow (after budget sign-off):

```
node bench/pilot/run.mjs --repeats <N> --seed <s>          # corpus grid (subdirs), NOT --sentinel
node bench/pilot/score-run.mjs --input <run-id>
node bench/pilot/analyze.mjs   --input <run-id>
```

Gate on the smoke-tested CLI versions (`claude 2.1.218`, `codex 0.144.6`); if either changed, re-smoke.

**The engineering question the grid answers:** *does adding `refs` reduce cost-weighted cost on
`search`/`range`-target, high-burden tasks (and stay neutral/negative on `neither`/low-burden tasks),
within these three deps* — analyzed **intent-to-treat** (a `full`-rung agent that ignores `refs`
counts as assigned-and-didn't-use, not excluded).

---

## Limits (read before quoting any number)

- **Descriptive, not confirmatory.** Every efficiency number is descriptive; bootstrap CIs are for
  transparency, not a powered significance/interaction test.
- **Correctness non-inferiority is not powered.** Pass rates are reported as observed; this study is
  not sized to certify refs doesn't hurt correctness.
- **Isolation is measured, not guaranteed.** Controls provably can't resolve `refs` via PATH and this
  is verified per run, but an absolute-path invocation of the real binary would bypass the shim's log
  (bounded, not eliminated).
- **Codex cost is a lower bound.** No cache-write telemetry from the codex CLI → its dollar figure is
  an API-list-price-equivalent lower bound, not subscription spend. Cross-model USD is date-stamped
  and labeled; token comparisons are **within-model only**.
- **3 deps ≠ population inference.** Three dependency clusters are too few for dependency-cluster
  bootstrap rigor; the analyzer surfaces per-task and per-dep deltas so the spread is visible, and
  labels any aggregate CI as assuming task independence.
- **Cache carryover not eliminated** (within-block randomization only).
- **Corpus is subagent-authored + controller-spot-verified.** Every fact was pulled from the real
  pinned checkouts (a sample was re-verified by hand), but the rubrics/labels should get a **human
  eye before the paid grid run** — freezing this corpus commit *is* the "seal". Negative-task
  deterministic regexes are intentionally permissive; discrimination lives in `material_errors`, which
  the grader weights.

**What a full *causal* study would additionally require** (deliberately out of scope here; see the
archived v2 plan + Codex reviews): preregistration + external-custody held-out corpus; a named exact
paired-binomial (Tango) non-inferiority test + power simulation; an allowlisted-runtime sandbox with a
bypass matrix; Williams counterbalancing / cold-start estimand; a multiplicity-controlled confirmatory
family; and ≫4-dep population inference. The conclusion here holds at the decision-grade bar, not the
publishable-causal bar.

Any product or marketing claim from these results remains a human decision.
