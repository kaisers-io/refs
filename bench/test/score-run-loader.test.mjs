// Regression: Pass B (score-run.mjs) must resolve tasks for the DEFAULT grid, which
// runs the corpus (tasks/<dep>/*.json), not just the sentinel set (top-level
// tasks/*.json). A sentinel-only loader returns undefined for every corpus record →
// scoreAnswer(undefined, …) throws → 100% score_error and an empty deliverable. This
// test hits the exported loader against the real tasks/ dir and asserts a known CORPUS
// id resolves — it FAILS against the old sentinel-only loader and passes after the fix.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadTasksById } from '../pilot/score-run.mjs';

const TASKS_DIR = fileURLToPath(new URL('../pilot/tasks/', import.meta.url));
const CORPUS_ID = 'zod-constructor-factory';
const SENTINEL_ID = 'zod-4-parser-range';

describe('score-run loadTasksById', () => {
  it('resolves a CORPUS task id (tasks/<dep>/*.json), not just sentinels', async () => {
    const tasksById = await loadTasksById(TASKS_DIR);
    expect(tasksById[CORPUS_ID]).toBeDefined();
    expect(tasksById[CORPUS_ID].id).toBe(CORPUS_ID);
  });

  it('still resolves a SENTINEL task id (top-level tasks/*.json)', async () => {
    const tasksById = await loadTasksById(TASKS_DIR);
    expect(tasksById[SENTINEL_ID]).toBeDefined();
    expect(tasksById[SENTINEL_ID].id).toBe(SENTINEL_ID);
  });
});
