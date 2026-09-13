#!/usr/bin/env node
// Runs the eval suite in evals/ against the refs skill under Codex, so its results can be set beside
// the Claude Code ones. Start it through `scripts/skill-evals.sh codex`, which builds the CLI and
// puts the same wrappers on PATH.
//
//   --runs <n>        runs per case (default: the case's own `runs`)
//   --case <name>     one case, or a glob with `*`
//   --model <slug>    default gpt-5.6-terra, the balanced tier, like the Claude suite's Sonnet
//   --effort <level>  reasoning effort, default medium
//   --json <file>     write the full result
//   --compare <file>  a Claude `aggregate-result.json` to print beside this run
//
// Runs are serial on purpose: they share one ChatGPT login, and Codex rotates its tokens, so
// parallel runs can refresh over each other. The login is a separate one in CODEX_HOME
// (default ~/.config/refs-eval-codex), never the operator's own, whose config, AGENTS.md and
// skills would otherwise leak into every run. Workspaces go under the system temp directory:
// inside this repository, Codex would pick up the repository's own AGENTS.md.

import { access, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { assertSupported, grade } from './skill-evals/graders.mjs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { parse } from 'yaml';
import { runOnce } from './skill-evals/codex-run.mjs';

const root = resolve(import.meta.dirname, '..');
const DEFAULT_RUNS = 3;
const PERCENT = 100;
const JSON_INDENT = 2;

const { values: flags } = parseArgs({
  options: {
    case: { type: 'string' },
    compare: { type: 'string' },
    effort: { default: 'medium', type: 'string' },
    json: { type: 'string' },
    model: { default: 'gpt-5.6-terra', type: 'string' },
    runs: { type: 'string' },
  },
});

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const matchesCaseFlag = (name) => {
  if (flags.case === undefined) {
    return true;
  }
  const escaped = flags.case
    .replaceAll(/[.+?^${}()|[\]\\]/gu, String.raw`\$&`)
    .replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`, 'u').test(name);
};

const loadCase = async (name) => {
  const text = await readFile(join(root, 'evals', name, 'case.yaml'), 'utf8');
  const testCase = Object.assign(parse(text), { name });
  for (const grader of testCase.graders) {
    assertSupported(name, grader);
  }
  return testCase;
};

const loadCases = async () => {
  const entries = await readdir(join(root, 'evals'), { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory() && matchesCaseFlag(entry.name));
  const withCase = await Promise.all(
    dirs.map(async ({ name }) =>
      (await exists(join(root, 'evals', name, 'case.yaml'))) ? name : '',
    ),
  );
  return Promise.all(withCase.filter(Boolean).map((name) => loadCase(name)));
};

const gradeRun = async (testCase, run) => {
  const graders = run.error
    ? []
    : await Promise.all(testCase.graders.map((grader) => grade(grader, run)));
  const passedGraders = graders.filter((result) => result.passed).length;
  const score = run.error ? 0 : passedGraders / testCase.graders.length;
  console.error(
    `${testCase.name}: ${run.error ?? `${passedGraders}/${graders.length}`} (${run.dir})`,
  );
  return { dir: run.dir, error: run.error, graders, passed: score === 1, score, usage: run.usage };
};

const runCase = async (testCase, settings) => {
  const runs = [];
  const count = Number(flags.runs ?? testCase.runs ?? DEFAULT_RUNS);
  for (let index = 0; index < count; index++) {
    const dir = join(settings.workdir, `${testCase.name}-${index}`);
    // eslint-disable-next-line no-await-in-loop -- serial is the point, see the header
    runs.push(await gradeRun(testCase, await runOnce(root, testCase, { dir, settings })));
  }
  return { name: testCase.name, runs };
};

const passRate = (runs) => `${runs.filter((run) => run.passed).length}/${runs.length}`;

const report = async (cases) => {
  const aggregate =
    flags.compare === undefined ? { cases: [] } : JSON.parse(await readFile(flags.compare, 'utf8'));
  const claude = new Map(aggregate.cases.map((entry) => [entry.name, passRate(entry.arms.with)]));
  for (const entry of cases) {
    const mean = entry.runs.reduce((sum, run) => sum + run.score, 0) / entry.runs.length;
    const beside = claude.has(entry.name) ? `   claude ${claude.get(entry.name)}` : '';
    console.log(
      `${entry.name}: codex ${passRate(entry.runs)} (mean ${Math.round(mean * PERCENT)}%)${beside}`,
    );
  }
};

const settingsFor = async () => {
  const codexHome =
    process.env.REFS_EVAL_CODEX_HOME ?? join(homedir(), '.config', 'refs-eval-codex');
  if (!(await exists(join(codexHome, 'auth.json')))) {
    throw new Error(`no Codex login in ${codexHome}: run CODEX_HOME=${codexHome} codex login`);
  }
  const workdir = await mkdtemp(join(tmpdir(), 'refs-codex-evals-'));
  const { stdout } = await promisify(execFile)('codex', ['--version']);
  return {
    codexHome,
    codexVersion: stdout.trim(),
    effort: flags.effort,
    model: flags.model,
    workdir,
  };
};

const writeResult = async (settings, cases) => {
  if (flags.json !== undefined) {
    const { codexVersion, effort, model, workdir } = settings;
    const result = { cases, codexVersion, effort, model, workdir };
    await writeFile(flags.json, `${JSON.stringify(result, undefined, JSON_INDENT)}\n`);
  }
};

const main = async () => {
  const settings = await settingsFor();
  const cases = [];
  for (const testCase of await loadCases()) {
    // eslint-disable-next-line no-await-in-loop -- serial is the point, see the header
    cases.push(await runCase(testCase, settings));
  }
  await report(cases);
  console.log(`runs kept in ${settings.workdir}`);
  await writeResult(settings, cases);
  process.exitCode = cases.every((entry) => entry.runs.every((run) => run.passed)) ? 0 : 1;
};

await main();
