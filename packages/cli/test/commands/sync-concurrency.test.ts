import { HTTPS_REF_ENTRY, withTempHome } from '../helpers/doctor-support.ts';
import type { RefKey, RefsHome } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { resolveHome, zRefKey, zSettings } from '@kaisers-io/refs-core';
import { syncAll, syncConcurrencyFrom } from '../../src/commands/sync-core.ts';
import type { CliContext } from '../../src/context.ts';
import type { RefSyncContext } from '../../src/commands/sync-checkout.ts';
import { createPeakRunner } from '../helpers/peak-runner.ts';
import { initHome } from '../helpers/add-support.ts';
import { seedConfig } from '../helpers/ref-fixtures.ts';
import { testContext } from '../helpers/context.ts';

// `refs sync` works on at most N refs at once. N defaults to 4 and `REFS_SYNC_CONCURRENCY` changes
// it, clamped so a typo cannot open dozens of connections to one forge. The batch cases drive the
// real `syncAll` against refs with no checkout, so every ref starts with a `git clone`; the runner
// fails each clone after recording how many were in flight, and the per-ref failure path is the
// one `syncAll` already guarantees never aborts the batch.

const DEFAULT_CAP = 4;
const MIN_CAP = 1;
const MAX_CAP = 16;
const SMALL_CAP = 2;
const MID_CAP = 6;
const OVER_MAX = 100;
// More refs than the largest cap, so every cap shows its full width and an unclamped value shows
// more.
const REF_COUNT = MAX_CAP + DEFAULT_CAP;
// What git exits with on a fatal error, which is all a failed clone needs to look like here.
const GIT_FATAL_EXIT = 128;

const keyAt = (index: number): RefKey => zRefKey.parse(`github.com/acme/repo-${index}`);

const KEYS = Array.from({ length: REF_COUNT }, (_unused, index) => keyAt(index));

const homeWithRefs = async (homeDir: string, env: NodeJS.ProcessEnv): Promise<CliContext> => {
  const { ctx } = testContext();
  ctx.env = { ...env, REFS_HOME: homeDir };
  await initHome(ctx);
  await seedConfig(
    resolveHome(ctx.env),
    Object.fromEntries(KEYS.map((key) => [key, HTTPS_REF_ENTRY])),
  );
  return ctx;
};

const targetsFor = (home: RefsHome): RefSyncContext[] => {
  const settings = zSettings.parse({});
  return KEYS.map((key) => ({
    home,
    key,
    ref: HTTPS_REF_ENTRY as RefSyncContext['ref'],
    settings,
  }));
};

/** Runs one batch and returns the peak number of clones in flight, after checking that every ref
 * came back as its own failure in input order. `width` is the peak the case expects: the runner
 * holds clones until that many are in flight, so a late starter cannot hide one. */
const peakOfBatch = async (
  homeDir: string,
  env: NodeJS.ProcessEnv,
  width: number,
): Promise<number> => {
  const ctx = await homeWithRefs(homeDir, env);
  const runner = createPeakRunner({
    respond: () => ({ exitCode: GIT_FATAL_EXIT, stderr: 'fatal: offline' }),
    total: REF_COUNT,
    width,
  });
  ctx.runner = runner;
  const results = await syncAll(ctx, targetsFor(resolveHome(ctx.env)));
  expect(results.map((item) => [item.key, item.status])).toStrictEqual(
    KEYS.map((key) => [key, 'failed']),
  );
  return runner.peak();
};

describe('sync concurrency setting', () => {
  it.each([
    [{}, DEFAULT_CAP],
    [{ REFS_SYNC_CONCURRENCY: '' }, DEFAULT_CAP],
    [{ REFS_SYNC_CONCURRENCY: String(SMALL_CAP) }, SMALL_CAP],
    [{ REFS_SYNC_CONCURRENCY: ` ${MID_CAP} ` }, MID_CAP],
    [{ REFS_SYNC_CONCURRENCY: '0' }, MIN_CAP],
    [{ REFS_SYNC_CONCURRENCY: String(MAX_CAP) }, MAX_CAP],
    [{ REFS_SYNC_CONCURRENCY: String(MAX_CAP + 1) }, MAX_CAP],
    [{ REFS_SYNC_CONCURRENCY: '99999999999999999999999' }, MAX_CAP],
    [{ REFS_SYNC_CONCURRENCY: '-3' }, DEFAULT_CAP],
    [{ REFS_SYNC_CONCURRENCY: '2.5' }, DEFAULT_CAP],
    [{ REFS_SYNC_CONCURRENCY: 'eight' }, DEFAULT_CAP],
    [{ REFS_SYNC_CONCURRENCY: '0x10' }, DEFAULT_CAP],
  ])('reads %j as %i at once', (env, expected) => {
    expect.hasAssertions();
    expect(syncConcurrencyFrom(env)).toBe(expected);
  });

  it.each([
    [{}, DEFAULT_CAP],
    [{ REFS_SYNC_CONCURRENCY: String(SMALL_CAP) }, SMALL_CAP],
    [{ REFS_SYNC_CONCURRENCY: String(OVER_MAX) }, MAX_CAP],
  ])('syncAll with %j keeps at most %i clones in flight', async (env, expected) => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await expect(peakOfBatch(homeDir, env, expected)).resolves.toBe(expected);
    });
  });
});
