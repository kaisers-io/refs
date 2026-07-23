import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';

const TASKS_DIR = new URL('../pilot/tasks/', import.meta.url);
const REQUIRED_KEYS = ['id', 'dep', 'ref', 'commit', 'job_type', 'question', 'critical_facts'];
const MIN_TASKS = 3;
const MIN_FACTS = 1;

const loadTasks = async () => {
  const files = await readdir(TASKS_DIR);
  const names = files.filter((name) => name.endsWith('.json'));
  return Promise.all(
    names.map(async (name) => {
      const text = await readFile(new URL(name, TASKS_DIR), 'utf8');
      return { name, task: JSON.parse(text) };
    }),
  );
};

describe('pilot tasks', () => {
  it('has at least the three pilot task files', async () => {
    const tasks = await loadTasks();
    expect(tasks.length).toBeGreaterThanOrEqual(MIN_TASKS);
  });

  it('every task file has the required fields and a non-empty critical_facts array', async () => {
    const tasks = await loadTasks();
    for (const { name, task } of tasks) {
      for (const key of REQUIRED_KEYS) {
        expect(task[key], `${name} missing ${key}`).toBeDefined();
      }
      expect(Array.isArray(task.critical_facts)).toBe(true);
      expect(task.critical_facts.length).toBeGreaterThanOrEqual(MIN_FACTS);
    }
  });
});
