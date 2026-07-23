// Cross-family judge wiring: score an answer with the OPPOSITE model family
// (Claude answers judged by Codex, and vice-versa — never same-family self-judging).
// The judge runs headless through the same isolated runCell seam and receives only
// the blinded payload from score.mjs (no model/rung identity).

import { runCell } from './runner.mjs';

// The outermost JSON object mentioning "criteria" in the judge's reply.
const VERDICT_RE = /\{[^]*"criteria"[^]*\}/u;

const JUDGE_PREAMBLE =
  'You are a strict, blinded grader. You receive a JSON payload with a question, a candidate ' +
  'answer, a list of criteria, and a list of material_errors. Grade EVERY criterion (does the ' +
  'answer satisfy it?) and EVERY material_error (does the answer commit it?), echoing each item ' +
  'text verbatim. Respond with ONLY a JSON object of the form ' +
  '{"criteria":[{"fact":"<criterion text>","pass":true}],' +
  '"material_errors":[{"error":"<error text>","present":false}]}. No prose.';

const extractVerdict = (raw) => {
  const match = raw.match(VERDICT_RE);
  if (!match) {
    return { criteria: [] };
  }
  const [json] = match;
  try {
    return JSON.parse(json);
  } catch {
    // Judge did not return parseable JSON — treat as no verdict.
    return { criteria: [] };
  }
};

// Returns a `judge(payload)` seam compatible with scoreAnswer. `judgeModel` is the
// cross-family model; `cwd` is a neutral directory (the judge needs no checkout).
// `judge: true` makes runCell tighten the CLI to grade TEXT only: the Claude judge
// runs with `--tools ""` (no tools); the Codex judge already runs `-s read-only`
// in the neutral JUDGE_CWD (set in score-run.mjs) — checkout effectively unmounted.
const makeJudge = (exec, judgeModel, cwd) => async (payload) => {
  const result = await runCell(exec, {
    cwd,
    judge: true,
    model: judgeModel,
    preamble: JUDGE_PREAMBLE,
    question: JSON.stringify(payload),
  });
  return extractVerdict(result.answer);
};

export { extractVerdict, makeJudge };
