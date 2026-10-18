// Positive and negative controls for the graders of the core-workflow cases, from
// grader-controls.mjs: source-provenance, version-compare, hostile-readme and
// add-hostile-description.
//
//   node --test scripts/skill-evals/core-workflow-graders.test.mjs
//
// The graders are read from the case files, so this pins what both eval runners grade with. Every
// grader must reject a deliberately wrong answer or command before a model run is trusted; the
// `fail` lists are those wrong answers.

import { deepStrictEqual, notDeepStrictEqual } from 'node:assert/strict';
import { graderFrom, graderNames } from './case-graders.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { CONTROLS } from './grader-controls.mjs';
import { grade } from './graders.mjs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tmpdir } from 'node:os';

const isFileTarget = (grader) => typeof grader.target === 'object';

/** One run that carries `sample` where `grader` looks: a Bash command, the transcript, a file in
 * the run directory, or the last message. */
const runOf = (grader, sample, cwd) => {
  if (grader.type === 'tool_used') {
    return { commands: [sample], cwd, lastMessage: '', trace: '' };
  }
  return grader.target === 'trace'
    ? { commands: [], cwd, lastMessage: '', trace: sample }
    : { commands: [], cwd, lastMessage: sample, trace: '' };
};

const gradeSample = async (grader, sample) => {
  const cwd = await mkdtemp(join(tmpdir(), 'refs-grader-'));
  try {
    if (isFileTarget(grader)) {
      await writeFile(join(cwd, grader.target.path), sample);
    }
    return await grade(grader, runOf(grader, sample, cwd));
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
};

/** The samples whose grade is not `expected`; empty when the grader behaves. */
const misgraded = async (grader, samples, expected) => {
  const results = await Promise.all(samples.map((sample) => gradeSample(grader, sample)));
  return samples.filter((_sample, index) => results[index].passed !== expected);
};

for (const control of CONTROLS) {
  test(`${control.case} / ${control.grader}: passes the right answers, fails the wrong ones`, async () => {
    const grader = await graderFrom(control.case, control.grader);
    deepStrictEqual(await misgraded(grader, control.pass, true), []);
    deepStrictEqual(await misgraded(grader, control.fail, false), []);
  });
}

const CASES = [...new Set(CONTROLS.map((control) => control.case))];

const hasWrongSample = (name, grader) =>
  CONTROLS.some((entry) => entry.case === name && entry.grader === grader && entry.fail.length > 0);

test('every grader of a controlled case has a wrong sample that fails it', async () => {
  const names = await Promise.all(CASES.map((name) => graderNames(name)));
  const uncontrolled = CASES.flatMap((name, index) =>
    names[index]
      .filter((grader) => !hasWrongSample(name, grader))
      .map((grader) => `${name} / ${grader}`),
  );
  deepStrictEqual(uncontrolled, []);
});

// A `boundary-` grader states something that must never happen, so it can only assert an absence:
// a regex that must not match, or a command that must run zero times.
test('every boundary grader asserts an absence', async () => {
  const graders = await Promise.all(
    CONTROLS.filter((control) => control.grader.startsWith('boundary-')).map((control) =>
      graderFrom(control.case, control.grader),
    ),
  );
  notDeepStrictEqual(graders, []);
  const presence = graders.filter((grader) =>
    grader.type === 'tool_used' ? grader.max !== 0 : grader.match !== 'not_contains',
  );
  deepStrictEqual(
    presence.map((grader) => grader.name),
    [],
  );
});

// add-monorepo has no controls of its own yet; its finalize boundary is this one, character for
// character, so the samples above pin both.
test('add-monorepo refuses a finalize exactly as add-hostile-description does', async () => {
  const [monorepo, hostile] = await Promise.all([
    graderFrom('add-monorepo', 'never-ran-finalize'),
    graderFrom('add-hostile-description', 'boundary-never-ran-finalize'),
  ]);
  deepStrictEqual(monorepo.input_match, hostile.input_match);
});
