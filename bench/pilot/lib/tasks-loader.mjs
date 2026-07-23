// Task corpus loading, split out of run.mjs to stay under its oxlint line cap. Two
// SEPARATE sources, never merged: sentinel tasks (top-level tasks/*.json) exist only for
// the Task 8 `--sentinel` CLI smoke test; the Wave-B analytic corpus lives one level down
// in tasks/<dep>/*.json subdirectories. Keeping the loaders apart means the sentinel set
// can never accidentally leak into the real per-dep analysis.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const JSON_EXT = '.json';

const isJsonFile = (name) => name.endsWith(JSON_EXT);

const readTask = async (dir, name) => JSON.parse(await readFile(join(dir, name), 'utf8'));

const jsonFileNames = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isJsonFile(entry.name))
    .map((entry) => entry.name);
};

const subdirNames = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
};

// Top-level tasks/*.json only — the sentinel set used by the Task 8 smoke test.
const loadSentinelTasks = async (tasksDir) => {
  const names = await jsonFileNames(tasksDir);
  return Promise.all(names.map((name) => readTask(tasksDir, name)));
};

const loadDepTasks = async (tasksDir, dep) => {
  const depDir = join(tasksDir, dep);
  const names = await jsonFileNames(depDir);
  return Promise.all(names.map((name) => readTask(depDir, name)));
};

// The Wave-B analytic corpus: tasks/<dep>/*.json, one level of dep subdirs. No
// subdirs yet (corpus not authored) resolves to [] without error.
const loadCorpusTasks = async (tasksDir) => {
  const deps = await subdirNames(tasksDir);
  const groups = await Promise.all(deps.map((dep) => loadDepTasks(tasksDir, dep)));
  return groups.flat();
};

export { loadCorpusTasks, loadSentinelTasks };
