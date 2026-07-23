// Sentinel tasks (top-level tasks/*.json, Task 8's --sentinel smoke test) and the
// Wave-B analytic corpus (tasks/<dep>/*.json subdirs) must stay separable — this test
// proves loadSentinelTasks and loadCorpusTasks each see only their own slice.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadCorpusTasks, loadSentinelTasks } from '../pilot/lib/tasks-loader.mjs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ONE = 1;
const ZERO = 0;

const writeTask = async (path, task) => {
  await writeFile(path, JSON.stringify(task));
};

describe('tasks-loader', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tasks-loader-'));
    await writeTask(join(dir, 's.json'), { id: 's' });
    await mkdir(join(dir, 'zod'), { recursive: true });
    await writeTask(join(dir, 'zod', 't.json'), { id: 't' });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it('loadSentinelTasks returns only the top-level sentinel task', async () => {
    const tasks = await loadSentinelTasks(dir);
    expect(tasks).toHaveLength(ONE);
    expect(tasks[ZERO].id).toBe('s');
  });

  it('loadCorpusTasks returns only the dep-subdir corpus task', async () => {
    const tasks = await loadCorpusTasks(dir);
    expect(tasks).toHaveLength(ONE);
    expect(tasks[ZERO].id).toBe('t');
  });

  it('loadCorpusTasks returns [] without error when there are no dep subdirs', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'tasks-loader-empty-'));
    const tasks = await loadCorpusTasks(emptyDir);
    expect(tasks).toEqual([]);
    await rm(emptyDir, { recursive: true });
  });
});
