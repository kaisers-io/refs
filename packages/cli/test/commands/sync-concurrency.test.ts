import { describe, expect, it } from 'vitest';
import { parseLastEnvelope, withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { EXIT } from '@kaisers-io/refs-core';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { exerciseSyncConcurrency } from '../helpers/sync-concurrency-support.ts';
import { run } from '../../src/main.ts';
import { testContext } from '../helpers/context.ts';

// Exercise the CLI parser and batch wiring, not just the semaphore primitive. The concurrency
// scenarios hold real Git clones behind explicit gates; no timer decides which clone is first.
const INVALID_COUNTS = [
  '',
  '0',
  '000',
  '-1',
  '1.5',
  '1e2',
  'NaN',
  'Infinity',
  'two',
  ' 2',
  '+2',
  '2\n',
];
const OVERFLOW_DIGITS = 400;
const VERY_LARGE_INTEGER = '9'.repeat(OVERFLOW_DIGITS);

describe('refs sync --concurrency', () => {
  it.each(INVALID_COUNTS)('rejects %j before reading config or spawning git', async (value) => {
    expect.hasAssertions();
    await withResetExitCode(async () => {
      const { ctx, runner, stdout } = testContext();
      await run(ctx, ['node', 'refs', 'sync', `--concurrency=${value}`, '--json']);
      expect(process.exitCode).toBe(EXIT.USAGE);
      expect(parseLastEnvelope(stdout)).toMatchObject({
        error: { code: 'usage', message: expect.stringContaining('positive decimal integer') },
        ok: false,
      });
      expect(runner.calls).toHaveLength(0);
    });
  });

  it.each([
    { count: undefined, label: 'default', limit: 4 },
    { count: '1', label: 'serial', limit: 1 },
    { count: '3', label: 'small', limit: 3 },
    { count: '16', label: 'maximum', limit: 16 },
    { count: '999', label: 'clamped', limit: 16 },
    { count: VERY_LARGE_INTEGER, label: 'overflow', limit: 16 },
  ])(
    '$label: bounds real clone pipelines at $limit, releases failed slots and keeps target order',
    async (scenario) => {
      expect.hasAssertions();
      await withResetExitCode(() => withTempHome((dir) => exerciseSyncConcurrency(dir, scenario)));
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
