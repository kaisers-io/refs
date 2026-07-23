// Pass B of the two-pass harness: read an immutable raw run, judge each answer,
// write scored.jsonl. EVERY raw record is RETAINED — a judge throw becomes
// {...record, score_error}, never a dropped answer, so Pass A's expensive real
// answers survive a judge crash. `scoreRawRecords` is pure and unit-tested;
// `main()` is thin glue that requires `--input <run-id>`.

import { loadCorpusTasks, loadSentinelTasks } from './lib/tasks-loader.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeJudge } from './lib/judge.mjs';
import { scoreAnswer } from './lib/score.mjs';
import { spawnExec } from './lib/exec.mjs';
import { tmpdir } from 'node:os';

const RESULTS_DIR = new URL('results/', import.meta.url);
const TASKS_DIR = fileURLToPath(new URL('tasks/', import.meta.url));
// Cross-family: each model's answers are judged by the OTHER model.
const JUDGE_OF = { claude: 'codex', codex: 'claude' };
// The judge grades text only — run it in a neutral dir, never the dependency checkout.
const JUDGE_CWD = tmpdir();
const NOT_FOUND = -1;
const NEXT = 1;
const FAIL_EXIT = 1;
const EMPTY = '';
const PASS_A_OK_CODE = 0;
// A real grid fans out 50+ records; judging all of them at once means 50+
// simultaneous paid `claude`/`codex` subprocess spawns -> provider rate-limiting
// / OS pressure -> mass score_error. Bound Pass-B judge concurrency instead.
const SCORE_CONCURRENCY = 4;

// A Pass-A cell that errored/failed/returned no answer would grade to pass:false
// regardless of what the judge says — skip the paid judge call for it entirely.
// Matches the two record shapes run.mjs produces: a normal cell record carries
// `failed`/`code`; an errorRecord() has neither and no `answer` at all.
const isPassAFailedOrEmpty = (record) =>
  record.failed === true ||
  (typeof record.code === 'number' && record.code !== PASS_A_OK_CODE) ||
  !record.answer;

const skippedScore = () => ({
  pass: false,
  reason: 'empty_or_failed_answer',
  skipped_judge: true,
});

// Retain the record no matter what: a missing task or a judge throw is captured as
// `score_error` alongside the untouched answer/telemetry, never a dropped record.
const scoreRecord = async (record, tasksById, judgeFactory) => {
  if (isPassAFailedOrEmpty(record)) {
    return { ...record, score: skippedScore() };
  }
  try {
    const judge = judgeFactory(record.model);
    const score = await scoreAnswer(tasksById[record.task_id], record.answer ?? EMPTY, judge);
    return { ...record, score };
  } catch (error) {
    return { ...record, score_error: String(error) };
  }
};

// Splits into fixed-size chunks (last chunk may be shorter); a plain sync loop,
// no await, so it needs no lint waiver.
const chunk = (items, size) => {
  const chunks = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
};

// Bounded-concurrency pool: judge at most `concurrency` records at once via one
// Promise.all per chunk, chunks resolved in sequence via reduce (not a for/while
// loop, so no-await-in-loop never fires). Promise.all resolves a chunk's results
// in the input order regardless of completion order, and chunks are appended in
// order, so the overall record order is stable.
// eslint-disable-next-line max-params -- records, task lookup, judge factory, and an optional concurrency override are the natural call signature
const scoreRawRecords = (records, tasksById, judgeFactory, concurrency = SCORE_CONCURRENCY) =>
  chunk(records, concurrency).reduce(async (accPromise, batch) => {
    const acc = await accPromise;
    const scored = await Promise.all(
      batch.map((record) => scoreRecord(record, tasksById, judgeFactory)),
    );
    return [...acc, ...scored];
  }, Promise.resolve([]));

// Returns the --input run-id, or EMPTY when the flag is absent (main hard-fails).
const parseInput = (argv) => {
  const index = argv.indexOf('--input');
  if (index === NOT_FOUND) {
    return EMPTY;
  }
  return argv[index + NEXT] ?? EMPTY;
};

// Optional --concurrency <n> override; defaults to SCORE_CONCURRENCY when absent.
const parseConcurrency = (argv) => {
  const index = argv.indexOf('--concurrency');
  if (index === NOT_FOUND) {
    return SCORE_CONCURRENCY;
  }
  return Number(argv[index + NEXT]);
};

// The DEFAULT grid runs the corpus (tasks/<dep>/*.json); the --sentinel smoke runs the
// top-level sentinel set. Load BOTH and key by id (disjoint by design) so Pass B can
// score either — a corpus-only or sentinel-only map silently score_errors the other.
const loadTasksById = async (tasksDir) => {
  const [corpus, sentinel] = await Promise.all([
    loadCorpusTasks(tasksDir),
    loadSentinelTasks(tasksDir),
  ]);
  return Object.fromEntries([...corpus, ...sentinel].map((task) => [task.id, task]));
};

const loadRaw = async (runId) => {
  const text = await readFile(new URL(`${runId}/raw.jsonl`, RESULTS_DIR), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== EMPTY)
    .map((line) => JSON.parse(line));
};

const writeScored = async (runId, scored) => {
  const path = new URL(`${runId}/scored.jsonl`, RESULTS_DIR);
  const body = scored.map((record) => JSON.stringify(record)).join('\n');
  await writeFile(fileURLToPath(path), `${body}\n`);
};

const judgeFactoryOf = (exec) => (model) => makeJudge(exec, JUDGE_OF[model], JUDGE_CWD);

const main = async () => {
  const runId = parseInput(process.argv);
  if (runId === EMPTY) {
    process.stderr.write('FATAL: score-run.mjs requires --input <run-id>\n');
    process.exit(FAIL_EXIT);
  }
  const concurrency = parseConcurrency(process.argv);
  const [records, tasksById] = await Promise.all([loadRaw(runId), loadTasksById(TASKS_DIR)]);
  const scored = await scoreRawRecords(records, tasksById, judgeFactoryOf(spawnExec), concurrency);
  await writeScored(runId, scored);
  process.stdout.write(`scored ${scored.length} records -> results/${runId}/scored.jsonl\n`);
};

const [, entryPath] = process.argv;
if (entryPath === import.meta.filename) {
  await main();
}

export { loadTasksById, scoreRawRecords };
