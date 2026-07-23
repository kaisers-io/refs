import { buildJudgePayload, scoreAnswer } from '../pilot/lib/score.mjs';
import { describe, expect, it } from 'vitest';

const task = {
  critical_facts: ['names the correct file', 'describes what it wraps'],
  deterministic: [{ kind: 'contains', pattern: 'src/types.ts' }],
  material_errors: ['cites a dist/ build artifact as the source of truth'],
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

const partialJudge = () =>
  Promise.resolve({ criteria: [{ fact: 'names the correct file', pass: true }] });

const materialErrorJudge = () =>
  Promise.resolve({
    criteria: [
      { fact: 'names the correct file', pass: true },
      { fact: 'describes what it wraps', pass: true },
    ],
    material_errors: [
      { error: 'cites a dist/ build artifact as the source of truth', present: true },
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

  it('fails (no fail-open) when the judge grades fewer facts than critical_facts', async () => {
    const score = await scoreAnswer(task, 'coerce lives in src/types.ts', partialJudge);
    expect(score.judge_complete).toBe(false);
    expect(score.pass).toBe(false);
  });

  it('fails when a material error is present even if all critical facts pass', async () => {
    const score = await scoreAnswer(
      task,
      'coerce lives in src/types.ts, per dist/index.js',
      materialErrorJudge,
    );
    expect(score.material_error_present).toBe(true);
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
