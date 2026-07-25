// Analyze a source-access pilot run: paired refs (B) vs no-source (A0) correctness.
//
// The experimental unit is the item (per model). For each (task, model) we compare the
// pass fraction across arms and bucket the pair into refs-wins / no-source-wins / both /
// neither. This is a directional pilot read — a raw discordance table, not a CI. Job
// type `negative-control` is reported separately (NC1 expects both-pass; NC2 expects
// refs to say "not recorded" where no-source may hallucinate a reason).

import { readFile, readdir } from 'node:fs/promises';

const RESULTS_DIR = new URL('results/', import.meta.url);
const NC = 'negative-control';
const HALF = 0.5;
const PERCENT = 100;
const ZERO = 0;
const ONE = 1;
const ID_WIDTH = 26;
const MODEL_WIDTH = 7;

const explicitArg = (argv) => argv[ONE + ONE];

const latestResults = async (argv) => {
  const explicit = explicitArg(argv);
  if (explicit) {
    return explicit;
  }
  const names = await readdir(RESULTS_DIR);
  const files = names.filter((name) => name.endsWith('.jsonl')).toSorted();
  if (files.length === ZERO) {
    throw new Error('no results/*.jsonl found — run run.mjs first');
  }
  return new URL(files.at(-ONE), RESULTS_DIR).pathname;
};

const readRecords = async (path) => {
  const text = await readFile(path, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
};

const tally = (cells, record) => {
  const key = `${record.task_id} ${record.model}`;
  const seed = { job_type: record.job_type, model: record.model, task_id: record.task_id };
  const entry = cells.get(key) ?? seed;
  const arm = (entry[record.arm] ??= { pass: ZERO, runs: ZERO });
  arm.runs += ONE;
  if (record.pass) {
    arm.pass += ONE;
  }
  cells.set(key, entry);
};

// Key -> { arm -> { pass, runs } }
const aggregate = (records) => {
  const cells = new Map();
  for (const record of records) {
    if (!record.error && record.pass !== undefined) {
      tally(cells, record);
    }
  }
  return [...cells.values()];
};

// Number.NaN is the "no data" sentinel (avoids null/undefined-return lint rules).
const frac = (arm) => {
  if (arm && arm.runs) {
    return arm.pass / arm.runs;
  }
  return Number.NaN;
};

const decisiveBucket = (refsWin, noSrcWin) => {
  if (refsWin) {
    return 'refs-wins';
  }
  if (noSrcWin) {
    return 'no-source-wins';
  }
  return 'neither';
};

const bucketOf = (refs, noSrc) => {
  if (Number.isNaN(refs) || Number.isNaN(noSrc)) {
    return 'incomplete';
  }
  const refsWin = refs > HALF;
  const noSrcWin = noSrc > HALF;
  if (refsWin && noSrcWin) {
    return 'both';
  }
  return decisiveBucket(refsWin, noSrcWin);
};

const pct = (num, den) => {
  if (den) {
    return `${Math.round((PERCENT * num) / den)}%`;
  }
  return '—';
};

const fmtFrac = (value) => {
  if (Number.isNaN(value)) {
    return ' — ';
  }
  return value.toFixed(ONE + ONE);
};

const cellLine = (cell, bucket) => {
  const refs = fmtFrac(frac(cell.refs));
  const noSrc = fmtFrac(frac(cell['no-source']));
  return `  ${cell.task_id.padEnd(ID_WIDTH)} ${cell.model.padEnd(MODEL_WIDTH)} refs=${refs} no-source=${noSrc}  ${bucket}`;
};

const summarize = (cells) => {
  const buckets = { both: ZERO, incomplete: ZERO, neither: ZERO, 'no-source-wins': ZERO, 'refs-wins': ZERO };
  const lines = [];
  for (const cell of cells) {
    const bucket = bucketOf(frac(cell.refs), frac(cell['no-source']));
    buckets[bucket] += ONE;
    lines.push(cellLine(cell, bucket));
  }
  return { buckets, lines };
};

const printBlock = (header, block) => {
  process.stdout.write(`\n== ${header} ==\n`);
  for (const line of block.lines.toSorted()) {
    process.stdout.write(`${line}\n`);
  }
  const box = block.buckets;
  const decisive = box['refs-wins'] + box['no-source-wins'];
  process.stdout.write(
    `  -- refs-wins=${box['refs-wins']} no-source-wins=${box['no-source-wins']} both=${box.both} neither=${box.neither} incomplete=${box.incomplete}\n`,
  );
  process.stdout.write(`  -- of decisive pairs, refs won ${pct(box['refs-wins'], decisive)}\n`);
};

const armPassRate = (records, arm) => {
  const rows = records.filter((record) => record.arm === arm && record.pass !== undefined && !record.error);
  const passed = rows.filter((record) => record.pass).length;
  return `${arm}: ${passed}/${rows.length} cells pass (${pct(passed, rows.length)})`;
};

const printHeader = (path, records) => {
  const errors = records.filter((record) => record.error).length;
  process.stdout.write(`file: ${path}\n`);
  process.stdout.write(`records: ${records.length} (errors: ${errors})\n`);
  process.stdout.write(`overall  ${armPassRate(records, 'no-source')}\n`);
  process.stdout.write(`overall  ${armPassRate(records, 'refs')}\n`);
};

const main = async () => {
  const path = await latestResults(process.argv);
  const records = await readRecords(path);
  const cells = aggregate(records);
  printHeader(path, records);
  printBlock(
    'Scored items (paired refs vs no-source)',
    summarize(cells.filter((cell) => cell.job_type !== NC)),
  );
  printBlock('Negative controls', summarize(cells.filter((cell) => cell.job_type === NC)));
  process.stdout.write(
    '\nNote: directional pilot read (raw discordance, no CI). CU1 items (p1/p2/p3) share one\nchange-unit — treat as ~1 observation. NC1 should land in "both"; NC2 tests honesty.\n',
  );
};

await main();

export { aggregate, bucketOf };
