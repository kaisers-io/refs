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

// Require EVERY critical fact to be graded (by identity) AND passed — a judge that
// returns fewer verdicts than facts must not pass the task (no fail-open).
const gradeFacts = (task, judged) => {
  const facts = task.critical_facts ?? [];
  const passByFact = new Map(judged.map((entry) => [entry.fact, entry.pass === true]));
  return {
    all: facts.length >= MIN_CRITERIA && facts.every((fact) => passByFact.get(fact) === true),
    complete: judged.length === facts.length,
  };
};

// Require EVERY material_error to be graded by identity (like critical_facts): a
// judge that OMITS a material_error must fail the task, never silently pass it.
const gradeMaterialErrors = (task, flagged) => {
  const errors = task.material_errors ?? [];
  const presentByError = new Map(flagged.map((entry) => [entry.error, entry.present === true]));
  return {
    complete: errors.every((error) => presentByError.has(error)),
    present: errors.some((error) => presentByError.get(error) === true),
  };
};

const scoreAnswer = async (task, answer, judge) => {
  const deterministic_pass = runDeterministic(task, answer);
  const verdict = await judge(buildJudgePayload(task, answer));
  const facts = gradeFacts(task, verdict.criteria ?? []);
  const materials = gradeMaterialErrors(task, verdict.material_errors ?? []);
  return {
    deterministic_pass,
    judge_complete: facts.complete,
    judged: verdict.criteria ?? [],
    material_error_present: materials.present,
    material_errors_complete: materials.complete,
    pass: deterministic_pass && facts.all && materials.complete && !materials.present,
  };
};

export { buildJudgePayload, runDeterministic, scoreAnswer };
