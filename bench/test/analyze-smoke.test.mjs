/* eslint-disable no-magic-numbers -- fabricated telemetry/burden fixtures; naming every token count would bury the planted signal the test asserts on */
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildCellRows,
  buildComplianceRows,
  buildDepDeltas,
  buildTaskDeltas,
  buildTrajectoryRows,
  buildWhereRefsWinRows,
} from '../pilot/lib/analysis.mjs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../pilot/lib/stats.mjs';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CI_OPTS = { alpha: 0.05, iterations: 300, rng: makeRng(99) };
const OPTS = { timeoutCapMs: 360_000 };
const ANALYZE = fileURLToPath(new URL('../pilot/analyze.mjs', import.meta.url));
const RESULTS_DIR = new URL('../pilot/results/', import.meta.url);
const SYNTH_ID = 'synthetic-smoke-test';

// Six synthetic tasks: three search-target (low/med/high output_bytes burden) and
// three range-target (low/med/high commit_count burden). PLANTED signal: in the
// high-burden strata, `full` costs far less than `discipline` (refs wins big); in the
// low-burden strata the two rungs cost the same (no refs advantage).
const TASKS = [
  { burden: { output_bytes: 10 }, dep: 'zod', id: 's-low', tool_target: 'search' },
  { burden: { output_bytes: 5000 }, dep: 'zod', id: 's-med', tool_target: 'search' },
  { burden: { output_bytes: 90_000 }, dep: 'next', id: 's-high', tool_target: 'search' },
  { burden: { commit_count: 2 }, dep: 'next', id: 'r-low', tool_target: 'range' },
  { burden: { commit_count: 40 }, dep: 'payload', id: 'r-med', tool_target: 'range' },
  { burden: { commit_count: 300 }, dep: 'payload', id: 'r-high', tool_target: 'range' },
];
const TASKS_BY_ID = Object.fromEntries(TASKS.map((task) => [task.id, task]));

// Output tokens per (task, rung): full is dramatically cheaper than discipline ONLY
// for the high-burden tasks; low-burden tasks cost identically across rungs.
const OUTPUT_BY_TASK = {
  'r-high': { discipline: 8000, full: 800 },
  'r-low': { discipline: 500, full: 500 },
  'r-med': { discipline: 3000, full: 2000 },
  's-high': { discipline: 9000, full: 900 },
  's-low': { discipline: 500, full: 500 },
  's-med': { discipline: 3000, full: 2000 },
};

const telemetryFor = (taskId, rung) => ({
  cache_read: 0,
  cache_write_5m: 0,
  input_uncached: 1000,
  output: OUTPUT_BY_TASK[taskId]?.[rung] ?? 1000,
});

const recordFor = ({ model, repeat, rung, taskId }) => ({
  code: 0,
  failed: false,
  model,
  raw: JSON.stringify({ num_turns: 4, result: 'ok' }),
  refs_calls: [],
  refs_on_path: '',
  repeat,
  rung,
  score: { pass: true },
  task_id: taskId,
  telemetry: telemetryFor(taskId, rung),
  wall_ms: 5000,
});

const MODELS = ['claude', 'codex'];
const RUNGS = ['naive', 'discipline', 'full'];
const REPEATS = [0, 1];

const buildRecords = () =>
  MODELS.flatMap((model) =>
    RUNGS.flatMap((rung) =>
      TASKS.flatMap((task) =>
        REPEATS.map((repeat) => recordFor({ model, repeat, rung, taskId: task.id })),
      ),
    ),
  );

const RECORDS = buildRecords();

afterAll(async () => {
  await rm(new URL(`${SYNTH_ID}/`, RESULTS_DIR), { force: true, recursive: true });
});

describe('analyzer pure builders: cost, rates, compliance', () => {
  it('builds per (model, rung) cells with cost, rates, and component means', () => {
    const rows = buildCellRows(RECORDS, OPTS);
    const claudeFull = rows.find((row) => row.model === 'claude' && row.rung === 'full');
    expect(claudeFull.count).toBe(12);
    expect(claudeFull.rates.pass).toBe(1);
    expect(claudeFull.cost.value).toBeGreaterThan(0);
    expect(claudeFull.cost.complete).toBe(true);
    expect(claudeFull.components.output).toBeGreaterThan(0);
  });

  it('flags codex cost as an incomplete lower bound (missing cache-write)', () => {
    const rows = buildCellRows(RECORDS, OPTS);
    const codexFull = rows.find((row) => row.model === 'codex' && row.rung === 'full');
    expect(codexFull.cost.complete).toBe(false);
  });

  it('reports 0% refs leakage when no control run touched refs', () => {
    const rows = buildComplianceRows(RECORDS);
    for (const row of rows) {
      expect(row.leakRate).toBe(0);
    }
  });

  it('detects a planted refs leak in a control run', () => {
    const leaky = [
      ...RECORDS,
      {
        ...recordFor({ model: 'claude', repeat: 5, rung: 'discipline', taskId: 's-low' }),
        refs_on_path: '/shim/refs',
      },
    ];
    const rows = buildComplianceRows(leaky);
    const claude = rows.find((row) => row.model === 'claude');
    expect(claude.leakRate).toBeGreaterThan(0);
  });
});

describe('analyzer pure builders: deltas and trajectory', () => {
  it('computes per-task Full-Discipline deltas (negative = refs cheaper)', () => {
    const deltas = buildTaskDeltas(RECORDS, 'claude', TASKS_BY_ID);
    const high = deltas.find((delta) => delta.task_id === 's-high');
    const low = deltas.find((delta) => delta.task_id === 's-low');
    expect(high.delta).toBeLessThan(0);
    expect(low.delta).toBe(0);
    expect(high.delta).toBeLessThan(low.delta);
  });

  it('surfaces the planted per-stratum difference in the where-refs-win table', () => {
    const deltas = buildTaskDeltas(RECORDS, 'claude', TASKS_BY_ID);
    const table = buildWhereRefsWinRows(deltas, CI_OPTS);
    const search = table.find((group) => group.target === 'search');
    const high = search.tertiles.find((row) => row.label === 'high');
    const low = search.tertiles.find((row) => row.label === 'low');
    expect(high.point).toBeLessThan(low.point);
    expect(high.point).toBeLessThan(0);
  });

  it('aggregates per-dep deltas', () => {
    const deltas = buildTaskDeltas(RECORDS, 'claude', TASKS_BY_ID);
    const deps = buildDepDeltas(deltas);
    expect(deps.length).toBeGreaterThanOrEqual(1);
    expect(deps.every((dep) => typeof dep.meanDelta === 'number')).toBe(true);
  });

  it('reports claude tool_calls as undefined (no trace) but codex as a real number', () => {
    const rows = buildTrajectoryRows(RECORDS);
    const claude = rows.find((row) => row.model === 'claude' && row.rung === 'full');
    const codex = rows.find((row) => row.model === 'codex' && row.rung === 'full');
    expect(claude.toolCalls).toBeUndefined();
    expect(claude.wallMs).toBe(5000);
    expect(typeof codex.turns).toBe('number');
  });
});

// CodexRawFor builds a minimal `codex exec --json` event stream with the given
// number of tool calls (command_execution) and turns (agent_message).
const codexRawFor = (toolCalls, turns) => {
  const commandEvents = Array.from({ length: toolCalls }, () =>
    JSON.stringify({
      item: { aggregated_output: 'abcdefghij', type: 'command_execution' },
      type: 'item.completed',
    }),
  );
  const turnEvents = Array.from({ length: turns }, () =>
    JSON.stringify({ item: { type: 'agent_message' }, type: 'item.completed' }),
  );
  return [...commandEvents, ...turnEvents].join('\n');
};

describe('analyzer pure builders: never silently impute invalid/missing data', () => {
  it('excludes invalid-telemetry records from componentMeans instead of zero-filling them', () => {
    const valid = recordFor({ model: 'claude', repeat: 0, rung: 'discipline', taskId: 's-low' });
    const invalid = {
      ...recordFor({ model: 'claude', repeat: 1, rung: 'discipline', taskId: 's-low' }),
      telemetry: { cache_read: undefined, invalid: true, output: undefined },
    };
    const rows = buildCellRows([valid, invalid], OPTS);
    const claudeDiscipline = rows.find(
      (row) => row.model === 'claude' && row.rung === 'discipline',
    );
    // If the invalid record were zero-filled in, this mean would be halved (500 -> 250).
    expect(claudeDiscipline.components.output).toBe(valid.telemetry.output);
  });

  it('excludes infra-error records (no raw) from trajectory means instead of counting them as zeros', () => {
    const real = {
      ...recordFor({ model: 'codex', repeat: 0, rung: 'full', taskId: 's-low' }),
      raw: codexRawFor(2, 1),
    };
    // Pass-A errorRecord shape: no `raw`, no telemetry, no wall_ms.
    const errorRecord = {
      error: 'timeout',
      model: 'codex',
      repeat: 1,
      rung: 'full',
      task_id: 's-low',
    };
    const rows = buildTrajectoryRows([real, errorRecord]);
    const codex = rows.find((row) => row.model === 'codex' && row.rung === 'full');
    // If the error record were counted as a real zero, these means would be halved.
    expect(codex.toolCalls).toBe(2);
    expect(codex.turns).toBe(1);
    expect(codex.toolBytes).toBe(20);
  });
});

describe('analyzer I/O shell (integration)', () => {
  it('renders the full report end-to-end via analyze.mjs --input', async () => {
    const dir = new URL(`${SYNTH_ID}/`, RESULTS_DIR);
    await mkdir(dir, { recursive: true });
    const body = RECORDS.map((record) => JSON.stringify(record)).join('\n');
    await writeFile(fileURLToPath(new URL('scored.jsonl', dir)), `${body}\n`);
    const { stdout } = await run(process.execPath, [ANALYZE, '--input', SYNTH_ID]);
    expect(stdout).toContain('where does refs win');
    expect(stdout).toContain('tool_target=');
    expect(stdout).toContain('descriptive engineering signal');
    // The synthetic ids don't exist in the real corpus main() joins against, so the
    // planted per-stratum signal is asserted via the pure builders above; this run
    // only proves the I/O shell renders every table end-to-end without throwing.
    expect(stdout).toContain('===== claude =====');
  });
});
