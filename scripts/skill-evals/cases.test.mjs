// Negative controls for the graders of the source, version and hostile-content cases (#220).
//
//   node --test scripts/skill-evals/cases.test.mjs
//
// Each case is graded on a crafted run that answers correctly, which must pass every grader, and on
// crafted wrong runs, each of which must fail exactly the graders named for it. A variant that names
// no grader is another correct run, there to show a grader does not reject a right answer. A grader
// no wrong run fails pins nothing, so every grader of these cases appears in some `fails` list.
// Grading goes through the Codex adapter, which reads the same case.yaml as `claude plugin eval`.
// The runs live in cases.fixtures.mjs, add-hostile-description's in cases.add.mjs and
// version-compare's in cases.versions.mjs; the checkout files they hold are in cases.files.mjs.

import { RIGHT as ADD_RIGHT, WRONG as ADD_WRONG } from './cases.add.mjs';
import { RIGHT as CASE_RIGHT, WRONG as CASE_WRONG } from './cases.fixtures.mjs';
import { RIGHT as VERSION_RIGHT, WRONG as VERSION_WRONG } from './cases.versions.mjs';
import { assertSupported, grade } from './graders.mjs';
import { dirname, join } from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { deepStrictEqual } from 'node:assert/strict';
import { parse } from 'yaml';
import { test } from 'node:test';
import { tmpdir } from 'node:os';

const loadGraders = async (name) => {
  const text = await readFile(new URL(`../../evals/${name}/case.yaml`, import.meta.url), 'utf8');
  const { graders } = parse(text);
  for (const grader of graders) {
    assertSupported(name, grader);
  }
  return graders;
};

// A run directory holding exactly `files`, so file graders read what the variant says is there.
// `created` lists the paths the run added, which is what `file_exists` graders read.
const runFor = async ({
  commands = [],
  created = [],
  files = {},
  lastMessage = '',
  trace = '',
}) => {
  const cwd = await mkdtemp(join(tmpdir(), 'case-graders-'));
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      await mkdir(dirname(join(cwd, path)), { recursive: true });
      await writeFile(join(cwd, path), content);
    }),
  );
  return { commands, created, cwd, lastMessage, trace };
};

const failing = async (graders, artifacts) => {
  const run = await runFor(artifacts);
  const results = await Promise.all(graders.map((grader) => grade(grader, run)));
  return results.filter((result) => !result.passed).map((result) => result.name);
};

const RIGHT = {
  ...CASE_RIGHT,
  'add-hostile-description': ADD_RIGHT,
  'version-compare': VERSION_RIGHT,
};
const WRONG = {
  ...CASE_WRONG,
  'add-hostile-description': ADD_WRONG,
  'version-compare': VERSION_WRONG,
};

for (const [name, right] of Object.entries(RIGHT)) {
  test(`${name}: a correct run passes every grader`, async () => {
    deepStrictEqual(await failing(await loadGraders(name), right), []);
  });

  for (const variant of WRONG[name]) {
    const outcome = variant.fails.length > 0 ? `fails ${variant.fails.join(', ')}` : 'passes';
    test(`${name}: ${variant.why} ${outcome}`, async () => {
      const files = { ...right.files, ...variant.files };
      const artifacts = { ...right, ...variant.run, created: variant.created ?? [], files };
      for (const path of variant.remove ?? []) {
        delete artifacts.files[path];
      }
      deepStrictEqual(await failing(await loadGraders(name), artifacts), variant.fails);
    });
  }

  test(`${name}: every grader is failed by some wrong run`, async () => {
    const graders = await loadGraders(name);
    const covered = new Set(WRONG[name].flatMap((variant) => variant.fails));
    deepStrictEqual(
      graders.map((grader) => grader.name).filter((grader) => !covered.has(grader)),
      [],
    );
  });
}
