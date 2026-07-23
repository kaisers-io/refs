// Pure smoke-selection helpers (Task 8: --tasks / --rungs). Filtering must keep
// only the named ids, report unmatched ids without silently ignoring them, and
// leave "empty after filtering" detectable by the caller. Rung validation must
// reject anything outside the known naive/discipline/full enum.

import { describe, expect, it } from 'vitest';
import { resolveRungs, selectTasks } from '../pilot/lib/cli-args.mjs';

const TASKS = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
const ALL_RUNGS = ['naive', 'discipline', 'full'];
const TWO = 2;
const ZERO = 0;

describe('selectTasks', () => {
  it('keeps only tasks whose id is named', () => {
    const { selected } = selectTasks(TASKS, ['t1', 't3']);
    expect(selected.map((task) => task.id)).toEqual(['t1', 't3']);
  });

  it('reports a named id that matched no loaded task', () => {
    const { missing, selected } = selectTasks(TASKS, ['t1', 'does-not-exist']);
    expect(missing).toEqual(['does-not-exist']);
    expect(selected.map((task) => task.id)).toEqual(['t1']);
  });

  it('is detectably empty when nothing matches', () => {
    const { missing, selected } = selectTasks(TASKS, ['nope']);
    expect(selected).toHaveLength(ZERO);
    expect(missing).toEqual(['nope']);
  });

  it('reports no missing ids when every requested id matches', () => {
    const { missing, selected } = selectTasks(TASKS, ['t1', 't2']);
    expect(missing).toEqual([]);
    expect(selected).toHaveLength(TWO);
  });
});

describe('resolveRungs', () => {
  it('accepts a subset of the known rung enum', () => {
    const { invalid, rungs } = resolveRungs(['naive', 'full'], ALL_RUNGS);
    expect(rungs).toEqual(['naive', 'full']);
    expect(invalid).toEqual([]);
  });

  it('rejects an unknown rung name', () => {
    const { invalid, rungs } = resolveRungs(['naive', 'bogus'], ALL_RUNGS);
    expect(invalid).toEqual(['bogus']);
    expect(rungs).toEqual(['naive']);
  });

  it('rejects a rung name that only differs in case', () => {
    const { invalid } = resolveRungs(['Naive'], ALL_RUNGS);
    expect(invalid).toEqual(['Naive']);
  });

  it('accepts every known rung when all three are named', () => {
    const { invalid, rungs } = resolveRungs(ALL_RUNGS, ALL_RUNGS);
    expect(rungs).toEqual(ALL_RUNGS);
    expect(invalid).toHaveLength(ZERO);
  });
});
