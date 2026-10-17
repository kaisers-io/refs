import { describe, expect, it } from 'vitest';
import { parseLastEnvelope, withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { EXIT } from '@kaisers-io/refs-core';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { incompleteMarker } from '../../src/commands/clone-lifecycle.ts';
import { inspectCheckout } from '../../src/commands/resolve-checkout.ts';
import { run } from '../../src/main.ts';
import { setupDryRunFixture } from '../helpers/add-guards-support.ts';
import { writeFile } from 'node:fs/promises';

const exerciseInterrupted = async (homeDir: string): Promise<void> => {
  const fixture = await setupDryRunFixture(homeDir);
  await writeFile(incompleteMarker(fixture.dest), '');
  await run(fixture.ctx, ['node', 'refs', 'add', fixture.sourceUrl, '--dry-run', '--json']);
  expect(process.exitCode).toBe(EXIT.CONFLICT);
  expect(parseLastEnvelope(fixture.stdout)).toMatchObject({
    error: { message: expect.stringContaining('interrupted clone') },
    ok: false,
  });
  await expect(
    inspectCheckout({
      allowFileUrls: true,
      dest: fixture.dest,
      expectedUrl: fixture.sourceUrl,
      hooksDir: fixture.home.hooksDir,
      sourcesDir: fixture.home.sourcesDir,
    }),
  ).resolves.toStrictEqual({ reason: 'clone_incomplete', status: 'unmanaged' });
};

describe('interrupted clone reuse', { timeout: SLOW_IO_TIMEOUT_MS }, () => {
  it('refuses a checkout with valid origin and hooks markers until its incomplete clone is cleaned up', async () => {
    expect.hasAssertions();
    await withResetExitCode(() => withTempHome(exerciseInterrupted));
  });
});
