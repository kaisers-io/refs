import { describe, expect, it } from 'vitest';
import { expandCells } from '../pilot/run-pilot.mjs';

const TASKS = [{ id: 't1' }, { id: 't2' }];
const MODELS = ['claude', 'codex'];
const RUNGS = ['naive', 'discipline', 'full'];
const REPEATS = 3;
const TWO_REPEATS = 2;

describe('expandCells', () => {
  it('produces one cell per task x model x rung x repeat', () => {
    const cells = expandCells(TASKS, MODELS, RUNGS, REPEATS);
    expect(cells).toHaveLength(TASKS.length * MODELS.length * RUNGS.length * REPEATS);
  });

  it('interleaves rungs rather than grouping them (some adjacent cells differ in rung)', () => {
    const cells = expandCells(TASKS, ['claude'], ['naive', 'full'], TWO_REPEATS);
    const rungs = cells.map((cell) => cell.rung);
    const [, ...tail] = rungs;
    const differsSomewhere = tail.some((rung, index) => rung !== rungs[index]);
    expect(differsSomewhere).toBe(true);
  });

  it('separates repeats of the same cell — repeat is the outermost dimension', () => {
    const cells = expandCells([{ id: 't1' }], ['claude'], ['naive'], TWO_REPEATS);
    const [first, second] = cells;
    expect(first.repeat).not.toBe(second.repeat);
  });
});
