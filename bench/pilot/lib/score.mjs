// Score one answer against a task's frozen rubric: deterministic checks first
// (objective, free), then a blinded LLM judge for the atomic-fact residue.
//
// TaskScore = { deterministic_pass, judged: {fact, pass}[], pass }
// pass = all deterministic checks pass AND every critical fact is judged pass.

const MIN_CRITERIA = 1;

const checkOne = (answer, check) => {
  if (check.kind === 'contains') {
    return answer.includes(check.pattern);
  }
  return new RegExp(check.pattern, 'u').test(answer);
};

const runDeterministic = (task, answer) =>
  (task.deterministic ?? []).every((check) => checkOne(answer, check));

// Blinded: only the question, the answer, and the atomic facts cross the boundary —
// never model / rung / tool-use identity (that stays in the caller, unserialized).
const buildJudgePayload = (task, answer) => ({
  answer,
  criteria: task.critical_facts,
  instruction:
    'For EACH criterion decide pass=true/false based solely on whether the answer satisfies it. ' +
    'For EACH material_error decide present=true/false based on whether the answer commits it. ' +
    'Ignore answer length and style. ' +
    'Return {"criteria":[{"fact","pass"}],"material_errors":[{"error","present"}]}.',
  material_errors: task.material_errors ?? [],
  question: task.question,
});

const scoreAnswer = async (task, answer, judge) => {
  const deterministic_pass = runDeterministic(task, answer);
  const verdict = await judge(buildJudgePayload(task, answer));
  const judged = verdict.criteria ?? [];
  const flagged = verdict.material_errors ?? [];
  const facts = task.critical_facts ?? [];
  // Require EVERY critical fact to be graded (by identity) AND passed — a judge that
  // returns fewer verdicts than facts must not pass the task (no fail-open).
  const passByFact = new Map(judged.map((entry) => [entry.fact, entry.pass === true]));
  const allFactsPass =
    facts.length >= MIN_CRITERIA && facts.every((fact) => passByFact.get(fact) === true);
  const judge_complete = judged.length === facts.length;
  const material_error_present = flagged.some((entry) => entry.present === true);
  return {
    deterministic_pass,
    judge_complete,
    judged,
    material_error_present,
    pass: deterministic_pass && allFactsPass && !material_error_present,
  };
};

export { buildJudgePayload, runDeterministic, scoreAnswer };
