# Source-access pilot harness

The pragmatic (screening-grade) harness for the benchmark designed in
[issue #16](https://github.com/kaisers-io/refs/issues/16): does giving an agent **real
dependency source** (via refs) improve answer **correctness** vs. **no source**?

This is the deliberately-cheap version — a directional read, not a citable measurement.
See the issue for what was cut vs. the rigorous design (no sandbox VM, two arms not
three, existing opposite-family judge, raw win/loss instead of CIs).

## What it does

Two arms, held identical except source availability:

- **`refs` (B)** — the agent runs in the real zod checkout (read + `git log`/`diff`/`grep`).
- **`no-source` (A0)** — the agent runs in an empty scratch dir; the preamble says there
  is no source. Answer from training memory only.

It reuses the Phase-B machinery unchanged (`../pilot/lib`): the `runCell` exec seam, the
blinded rubric scorer (`score.mjs`), and the cross-family judge (`judge.mjs`). The only
difference between arms is **cwd + preamble** (`conditions/*.md`).

## Layout

- `conditions/` — the two arm preambles.
- `tasks/*.json` — the frozen items (question + `critical_facts` + `material_errors`),
  distilled from `../source-access/pilot-corpus.md`. All anchored to the frozen zod
  checkout (HEAD `912f0f51`); versions/commits are named in each question.
- `run.mjs` — orchestrator (arms × models × tasks × repeats), bounded concurrency.
- `analyze.mjs` — paired refs-vs-no-source discordance table.

## Run

```bash
export PATH="$HOME/.nvm/versions/node/v26.4.0/bin:$PATH"   # needs Node >=24.12 for refs

# Full pilot (~9 items x 2 arms x 2 models x 3 repeats ~= 108 gen cells + judging):
node bench/source-access/run.mjs

# Cheaper smoke of the REAL pipeline (one item, one model, one repeat):
node bench/source-access/run.mjs --tasks p2 --models claude --repeats 1 --concurrency 1

# Flags: --repeats N  --seed N  --concurrency N  --models claude,codex  --tasks p1,p7

# Then:
node bench/source-access/analyze.mjs        # newest results/*.jsonl
```

Results land in `results/<timestamp>.jsonl` (git-ignored), one line per cell.

## Honesty / caveats

- **Screening-grade.** Directional signal only; CU1 items (p1/p2/p3) share one
  change-unit → ~1 observation. Judge is opposite-family (pilot-grade), not a third family.
- **No egress sandbox.** A0 gets no source and is told not to fetch; residual leak (a
  built-in web tool) would only make A0 look *better*, i.e. bias *against* refs — so a
  positive result is conservative. Spot-check transcripts.
- **Gate to confirmatory:** proceed to the rigorous build only if the pilot shows a
  refs-vs-no-source signal above the noise, sane judge behavior, and clean transcripts.
