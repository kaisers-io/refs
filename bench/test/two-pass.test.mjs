import { describe, expect, it } from 'vitest';
import { scoreRawRecords } from '../pilot/score-run.mjs';

const task = {
  critical_facts: ['names the file'],
  id: 't1',
  material_errors: [],
  question: 'where?',
};
const tasksById = { t1: task };

const makeRecord = (overrides) => ({
  answer: 'it is in src/foo.ts',
  failed: false,
  model: 'claude',
  repeat: 0,
  rung: 'full',
  task_id: 't1',
  telemetry: { model: 'claude', output: 10 },
  ...overrides,
});

// A judgeFactory(model) returns a judge(payload) that resolves a verdict.
const passingFactory = () => () =>
  Promise.resolve({ criteria: [{ fact: 'names the file', pass: true }], material_errors: [] });

const throwingFactory = () => () => Promise.reject(new Error('judge boom'));

// Spy factory: records every payload it is asked to judge, so a skip that "just
// happens" to never call the judge (bug) is distinguishable from a skip that
// correctly bypasses the judge only for failed/empty records.
const makeSpyFactory = () => {
  const calls = [];
  const factory = () => (payload) => {
    calls.push(payload);
    return Promise.resolve({
      criteria: [{ fact: 'names the file', pass: true }],
      material_errors: [],
    });
  };
  return { calls, factory };
};

const ONE = 1;
const THREE = 3;
const FIVE = 5;
const CHUNK_SIZE = 2;
const ERROR_CODE = 1;
const OK_CODE = 0;
const EMPTY = '';
const SKIPPED_SCORE = { pass: false, reason: 'empty_or_failed_answer', skipped_judge: true };

describe('scoreRawRecords', () => {
  it('retains every record when scoring a run', async () => {
    const records = Array.from({ length: THREE }, () => makeRecord({}));
    const scored = await scoreRawRecords(records, tasksById, passingFactory);
    const [first] = scored;
    expect(scored).toHaveLength(THREE);
    expect(scored.every((record) => record.score !== undefined)).toBe(true);
    expect(first.score.pass).toBe(true);
  });

  it('retains a judge-throw record with score_error, preserving answer + telemetry', async () => {
    const record = makeRecord({});
    const [scored] = await scoreRawRecords([record], tasksById, throwingFactory);
    expect(scored.score_error).toContain('judge boom');
    expect(scored.score).toBeUndefined();
    expect(scored.answer).toBe(record.answer);
    expect(scored.telemetry).toEqual(record.telemetry);
  });

  it('skips the judge for Pass-A failed/empty records but still calls it for a valid one', async () => {
    const { calls, factory } = makeSpyFactory();
    const failedRecord = makeRecord({ answer: EMPTY, code: ERROR_CODE, failed: true });
    const emptyOkRecord = makeRecord({ answer: EMPTY, code: OK_CODE, failed: false });
    const validRecord = makeRecord({});
    const [failedScored, emptyOkScored, validScored] = await scoreRawRecords(
      [failedRecord, emptyOkRecord, validRecord],
      tasksById,
      factory,
    );
    expect(failedScored.score).toEqual(SKIPPED_SCORE);
    expect(emptyOkScored.score).toEqual(SKIPPED_SCORE);
    expect(validScored.score.pass).toBe(true);
    expect(calls).toHaveLength(ONE);
  });

  it('preserves record order across bounded-concurrency chunks', async () => {
    const records = Array.from({ length: FIVE }, (_value, index) => makeRecord({ repeat: index }));
    const scored = await scoreRawRecords(records, tasksById, passingFactory, CHUNK_SIZE);
    expect(scored.map((record) => record.repeat)).toEqual(records.map((record) => record.repeat));
  });
});
