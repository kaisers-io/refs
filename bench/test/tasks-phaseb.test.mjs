import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadCorpusTasks } from '../pilot/lib/tasks-loader.mjs';

// Validates the Phase-B analytic corpus (bench/pilot/tasks/<dep>/*.json) as a whole:
// outcome-blind tool_target labels, a frozen baseline_query per task, construct-
// appropriate measured burden, >=3 deps, all six job_types, and both a high-burden
// search/range group AND a neither control group (the plan's "where does refs win"
// design). Structural only — burden freshness is guarded at run time by the
// commit-drift hard-fail (each task pins the commit its burden was measured at).

const TASKS_DIR = fileURLToPath(new URL('../pilot/tasks/', import.meta.url));
const JOB_TYPES = [
  'behavior-explanation',
  'cross-file',
  'history',
  'negative',
  'symbol-localization',
  'version-range',
];
const TOOL_TARGETS = ['neither', 'range', 'search'];
const MIN_DEPS = 3;
const MIN_ONE = 1;
const ZERO = 0;
const HIGH_SEARCH_HITS = 50;
const HIGH_RANGE_COMMITS = 3;

const corpus = await loadCorpusTasks(TASKS_DIR);

const hasSearchBurden = (task) => typeof task.burden?.grep_hits === 'number';
const hasRangeBurden = (task) => typeof task.burden?.commit_count === 'number';

// Burden is measured per construct, not per tool_target: a `neither` history question
// is measured with git log (commit_count), a localization one with git grep (grep_hits).
const hasHighBurden = (task) => {
  if (task.tool_target === 'search') {
    return (task.burden?.grep_hits ?? ZERO) >= HIGH_SEARCH_HITS;
  }
  if (task.tool_target === 'range') {
    return (task.burden?.commit_count ?? ZERO) >= HIGH_RANGE_COMMITS;
  }
  return false;
};

const nonEmptyArray = (value) => Array.isArray(value) && value.length >= MIN_ONE;

const expectValidTask = (task) => {
  expect(TOOL_TARGETS, `${task.id} tool_target`).toContain(task.tool_target);
  expect(JOB_TYPES, `${task.id} job_type`).toContain(task.job_type);
  expect(Array.isArray(task.eligible_tools), `${task.id} eligible_tools`).toBe(true);
  expect(typeof task.baseline_query === 'string' && task.baseline_query.length >= MIN_ONE).toBe(
    true,
  );
  expect(task.burden, `${task.id} burden`).toBeTypeOf('object');
  expect(task.commit, `${task.id} commit`).toBeTruthy();
  expect(nonEmptyArray(task.critical_facts), `${task.id} critical_facts`).toBe(true);
  expect(Array.isArray(task.material_errors), `${task.id} material_errors`).toBe(true);
  expect(Array.isArray(task.evidence), `${task.id} evidence`).toBe(true);
};

describe('Phase-B corpus', () => {
  it('loads a non-empty corpus spanning at least three deps', () => {
    expect(corpus.length).toBeGreaterThan(MIN_ONE);
    const deps = new Set(corpus.map((task) => task.dep));
    expect(deps.size).toBeGreaterThanOrEqual(MIN_DEPS);
  });

  it('every task carries the analytic fields with valid enums', () => {
    for (const task of corpus) {
      expectValidTask(task);
    }
  });

  it('carries a measured burden in a recognized construct (search grep or range/history log)', () => {
    for (const task of corpus) {
      expect(hasSearchBurden(task) || hasRangeBurden(task), `${task.id} measured burden`).toBe(true);
      if (task.tool_target === 'range') {
        expect(hasRangeBurden(task), `${task.id} range task has commit_count`).toBe(true);
      }
    }
  });

  it('covers all six job_types', () => {
    const present = new Set(corpus.map((task) => task.job_type));
    for (const jobType of JOB_TYPES) {
      expect(present, `missing job_type ${jobType}`).toContain(jobType);
    }
  });

  it('spans every tool_target and includes a high-burden helper group and a neither control', () => {
    const present = new Set(corpus.map((task) => task.tool_target));
    for (const target of TOOL_TARGETS) {
      expect(present, `missing tool_target ${target}`).toContain(target);
    }
    expect(corpus.some((task) => hasHighBurden(task))).toBe(true);
    expect(corpus.some((task) => task.tool_target === 'neither')).toBe(true);
  });
});
