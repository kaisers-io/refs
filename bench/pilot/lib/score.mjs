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
    'For EACH criterion, decide pass=true or pass=false based solely on whether the answer ' +
    'satisfies it. Ignore answer length and style. Return {"criteria":[{"fact","pass"}]}.',
  question: task.question,
});

const scoreAnswer = async (task, answer, judge) => {
  const deterministic_pass = runDeterministic(task, answer);
  const verdict = await judge(buildJudgePayload(task, answer));
  const judged = verdict.criteria ?? [];
  const allFactsPass =
    judged.length >= MIN_CRITERIA && judged.every((entry) => entry.pass === true);
  return { deterministic_pass, judged, pass: deterministic_pass && allFactsPass };
};

export { buildJudgePayload, runDeterministic, scoreAnswer };
