import { armCwd, expandCells, runOneCell } from '../source-access/run.mjs';
import { describe, expect, it } from 'vitest';

const OK = 0;
const REPEATS = 3;
const FIRST = 0;

const task = {
  change_unit: 'CU1',
  critical_facts: ['fact a'],
  id: 't1',
  job_type: 'behavior',
  material_errors: ['err b'],
  question: 'Q?',
  ref: 'github.com/x/y',
};

// A blinded verdict that passes the single fact and flags no material error.
const VERDICT = JSON.stringify({
  criteria: [{ fact: 'fact a', pass: true }],
  material_errors: [{ error: 'err b', present: false }],
});

// Cross-family fake: the claude agent returns an answer; the codex judge returns the
// verdict as its final agent_message (mirrors the real JSONL shape).
const fakeExec = (cmd) => {
  if (cmd === 'claude') {
    return Promise.resolve({
      code: OK,
      stderr: '',
      stdout: JSON.stringify({ result: 'the answer', usage: { input_tokens: 1, output_tokens: 1 } }),
    });
  }
  return Promise.resolve({
    code: OK,
    stderr: '',
    stdout: [
      `{"type":"item.completed","item":{"type":"agent_message","text":${JSON.stringify(VERDICT)}}}`,
      '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}',
    ].join('\n'),
  });
};

const ctx = {
  checkoutPath: '/co',
  preambles: { 'no-source': 'NP', refs: 'RP' },
  scratchDir: '/scratch',
};

describe('source-access grid', () => {
  it('expandCells covers arms x models x tasks x repeats', () => {
    const tasks = [task, task];
    const models = ['claude', 'codex'];
    const arms = ['no-source', 'refs'];
    const cells = expandCells(tasks, models, arms, REPEATS);
    expect(cells.length).toBe(tasks.length * models.length * arms.length * REPEATS);
    expect(cells.every((cell) => cell.arm && cell.model && cell.task)).toBe(true);
  });

  it('armCwd routes refs to the checkout and no-source to the scratch dir', () => {
    expect(armCwd('refs', '/co', '/scratch')).toBe('/co');
    expect(armCwd('no-source', '/co', '/scratch')).toBe('/scratch');
  });

  it('runOneCell runs the agent in the arm cwd, judges cross-family, and scores', async () => {
    const calls = [];
    const spy = (cmd, args, opts) => {
      calls.push({ cmd, opts });
      return fakeExec(cmd, args, opts);
    };
    const record = await runOneCell(spy, { arm: 'refs', model: 'claude', repeat: FIRST, task }, ctx);
    expect(record.answer).toBe('the answer');
    expect(record.arm).toBe('refs');
    expect(record.pass).toBe(true);
    // Agent ran in the checkout cwd; judge (codex) ran somewhere neutral.
    expect(calls[FIRST]).toEqual({ cmd: 'claude', opts: { cwd: '/co' } });
    expect(calls.some((call) => call.cmd === 'codex')).toBe(true);
  });

  it('no-source cell runs the agent in the scratch dir', async () => {
    const calls = [];
    const spy = (cmd, args, opts) => {
      calls.push({ cmd, opts });
      return fakeExec(cmd, args, opts);
    };
    await runOneCell(spy, { arm: 'no-source', model: 'claude', repeat: FIRST, task }, ctx);
    expect(calls[FIRST]).toEqual({ cmd: 'claude', opts: { cwd: '/scratch' } });
  });
});
