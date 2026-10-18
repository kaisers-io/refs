import {
  DEFAULT_SYNC_CONCURRENCY,
  MAX_SYNC_CONCURRENCY,
  syncConcurrencyFrom,
} from '../../src/commands/sync-concurrency.ts';
import { EXIT, resolveHome } from '@kaisers-io/refs-core';
import type { RunResult, Runner } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { parseLastEnvelope, withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { HTTPS_REF_ENTRY } from '../helpers/doctor-support.ts';
import { run } from '../../src/main.ts';
import { seedConfig } from '../helpers/ref-fixtures.ts';
import { setTimeout } from 'node:timers/promises';
import { testContext } from '../helpers/context.ts';

// `refs sync --concurrency <n>`, from the flag to the batch: the value is checked before anything
// runs, and the batch really holds that many refs in flight, no more and (with enough refs) no
// fewer. Every clone here fails, so this also pins that a failed ref gives its slot back.

const REFS = 10;
const SLOW_CHILD_MS = 15;
// Far past what a Number holds exactly: must be refused, not read as Infinity or rounded.
const OVERFLOW_DIGITS = 400;
const KEY_DIGITS = 2;
const keyAt = (index: number): string =>
  `github.com/acme/r${String(index).padStart(KEY_DIGITS, '0')}`;
const KEYS = Array.from({ length: REFS }, (_unused, index) => keyAt(index));

describe('the --concurrency value', () => {
  it('defaults to 4 and takes a whole number from 1 to 16', () => {
    expect.hasAssertions();
    expect(syncConcurrencyFrom()).toBe(DEFAULT_SYNC_CONCURRENCY);
    expect(syncConcurrencyFrom('1')).toBe(1);
    expect(syncConcurrencyFrom('16')).toBe(MAX_SYNC_CONCURRENCY);
  });

  it.each([
    '',
    '0',
    '00',
    '17',
    '999',
    '9'.repeat(OVERFLOW_DIGITS),
    '-1',
    '+2',
    ' 2',
    '2\n',
    '1.5',
    '1e1',
  ])('refuses %j with the range', (raw) => {
    expect.hasAssertions();
    expect(() => syncConcurrencyFrom(raw)).toThrow(
      `--concurrency must be a whole number from 1 to 16 — got '${raw}'`,
    );
  });
});

type Counter = Runner & { calls: number; peak: number };

/** Every git child takes a moment and fails, as a clone from an unreachable host would. */
const failingCounter = (): Counter => {
  let inFlight = 0;
  const counter: Counter = {
    calls: 0,
    peak: 0,
    run: async (): Promise<RunResult> => {
      counter.calls += 1;
      inFlight += 1;
      counter.peak = Math.max(counter.peak, inFlight);
      await setTimeout(SLOW_CHILD_MS);
      inFlight -= 1;
      return { exitCode: 128, stderr: 'fatal: unable to access', stdout: '' };
    },
  };
  return counter;
};

type Outcome = { counter: Counter; envelope: unknown };

const syncWith = async (homeDir: string, flags: readonly string[]): Promise<Outcome> => {
  const home = resolveHome({ REFS_HOME: homeDir });
  await seedConfig(home, Object.fromEntries(KEYS.map((key) => [key, HTTPS_REF_ENTRY])));
  const { ctx, stdout } = testContext();
  ctx.env = { REFS_HOME: homeDir, REFS_UPDATE_CHECK: '0' };
  const counter = failingCounter();
  ctx.runner = counter;
  await run(ctx, ['node', 'refs', 'sync', ...flags, '--json']);
  return { counter, envelope: parseLastEnvelope(stdout) };
};

type SyncEnvelope = { data: { results: { key: string; status: string }[] } };

describe('refs sync --concurrency, end to end', () => {
  it.each([
    { flags: [], peak: 4 },
    { flags: ['--concurrency', '1'], peak: 1 },
    { flags: ['--concurrency=3'], peak: 3 },
  ])('holds $peak refs in flight for $flags and reports every ref', async ({ flags, peak }) => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { counter, envelope } = await syncWith(homeDir, flags);
        const { results } = (envelope as SyncEnvelope).data;
        expect(counter.peak).toBe(peak);
        expect(results.map((item) => item.key)).toStrictEqual(KEYS);
        expect(results.every((item) => item.status === 'failed')).toBe(true);
        expect(process.exitCode).toBe(EXIT.UNEXPECTED);
      }),
    );
  });

  it('refuses a bad value before running anything', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { counter, envelope } = await syncWith(homeDir, ['--concurrency', '0']);
        expect(counter.calls).toBe(0);
        expect(process.exitCode).toBe(EXIT.USAGE);
        expect(envelope).toMatchObject({ error: { code: 'usage' }, ok: false });
      }),
    );
  });
});
