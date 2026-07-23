import { buildJudgePayload, scoreAnswer } from '../pilot/lib/score.mjs';
import { describe, expect, it } from 'vitest';

const task = {
  critical_facts: ['names the correct file', 'describes what it wraps'],
  deterministic: [{ kind: 'contains', pattern: 'src/types.ts' }],
  question: 'Where is coerce?',
};

const emptyJudge = () => Promise.resolve({ criteria: [] });

const passingJudge = () =>
  Promise.resolve({
    criteria: [
      { fact: 'names the correct file', pass: true },
      { fact: 'describes what it wraps', pass: true },
    ],
  });

const oneFailingJudge = () =>
  Promise.resolve({
    criteria: [
      { fact: 'names the correct file', pass: true },
      { fact: 'describes what it wraps', pass: false },
    ],
  });

describe('scoreAnswer', () => {
  it('fails fast when a deterministic check misses', async () => {
    const score = await scoreAnswer(task, 'it is in dist/index.js', emptyJudge);
    expect(score.deterministic_pass).toBe(false);
    expect(score.pass).toBe(false);
  });

  it('passes when deterministic and all critical facts are judged pass', async () => {
    const score = await scoreAnswer(
      task,
      'coerce lives in src/types.ts and wraps the base schemas',
      passingJudge,
    );
    expect(score.pass).toBe(true);
  });

  it('fails when a critical fact is judged fail even though deterministic passes', async () => {
    const score = await scoreAnswer(task, 'coerce lives in src/types.ts', oneFailingJudge);
    expect(score.deterministic_pass).toBe(true);
    expect(score.pass).toBe(false);
  });
});

describe('buildJudgePayload', () => {
  it('omits model and rung identity so the judge is blinded', () => {
    const payload = buildJudgePayload(task, 'some answer', { model: 'claude', rung: 'full' });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('claude');
    expect(serialized).not.toContain('rung');
  });
});
