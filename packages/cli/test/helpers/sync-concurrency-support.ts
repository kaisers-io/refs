import {
  EXIT,
  SpawnRunner,
  canonicalizeGitUrl,
  readState,
  resolveHome,
} from '@kaisers-io/refs-core';
import type { RefEntry, Runner } from '@kaisers-io/refs-core';
import { cp, rm } from 'node:fs/promises';
import { initHome, parseLastEnvelope, realContextFor } from './add-support.ts';
import type { SyncResultItem } from '../../src/commands/sync-core.ts';
import { createFixtureRepo } from './fixture-repo.ts';
import { expect } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from '../../src/main.ts';
import { seedConfig } from './ref-fixtures.ts';

const POLL_TIMEOUT_MS = 10_000;
const QUEUED_REFS = 2;
const CLONE_URL_OFFSET = -2;

type CloneGate = { release: () => void; url: string };
type CloneProbe = {
  gates: CloneGate[];
  peak: () => number;
  open: () => void;
  runner: Runner;
};

const gateClone = async (
  gates: CloneGate[],
  args: readonly string[],
  opened: boolean,
): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  // cloneRepo terminates its argv with `-- <url> <destination>`.
  const url = args.at(CLONE_URL_OFFSET);
  if (url === undefined) {
    throw new Error('clone URL missing');
  }
  gates.push({ release: resolve, url });
  if (opened) {
    resolve();
  }
  await promise;
};

/** Observe actual Git clones while controlling only when they may start. Every command and its
 * outcome still comes from SpawnRunner, including the deliberately absent upstream. */
const cloneProbe = (): CloneProbe => {
  const real = new SpawnRunner();
  const gates: CloneGate[] = [];
  const state = { active: 0, maximum: 0, opened: false };
  const execute: Runner['run'] = async (cmd, args, opts) => {
    if (!args.includes('clone')) {
      return real.run(cmd, args, opts);
    }
    state.active += 1;
    state.maximum = Math.max(state.active, state.maximum);
    await gateClone(gates, args, state.opened);
    try {
      return await real.run(cmd, args, opts);
    } finally {
      state.active -= 1;
    }
  };
  return {
    gates,
    open: () => {
      state.opened = true;
      for (const gate of gates) {
        gate.release();
      }
    },
    peak: () => state.maximum,
    runner: { run: execute },
  };
};

const copyUpstream = async (source: string, dir: string): Promise<readonly [string, RefEntry]> => {
  await cp(source, dir, { recursive: true });
  const url = pathToFileURL(dir).href;
  return [
    canonicalizeGitUrl(url, { allowFileUrls: true }).key,
    { default_branch: 'main', description: 'Concurrency fixture.', url },
  ];
};

const seedUpstreams = async (dir: string, count: number): Promise<Record<string, RefEntry>> => {
  const fixture = await createFixtureRepo();
  try {
    return Object.fromEntries(
      await Promise.all(
        Array.from({ length: count }, (_unused, index) =>
          copyUpstream(fixture.dir, join(dir, 'upstreams', `repo-${String(index)}`)),
        ),
      ),
    );
  } finally {
    await rm(fixture.dir, { force: true, recursive: true });
  }
};

type SyncScenario = { count: string | undefined; limit: number };
type SyncBatch = {
  brokenUrl: string;
  ctx: ReturnType<typeof realContextFor>['ctx'];
  keys: string[];
  stdout: string[];
};

const prepareBatch = async (dir: string, limit: number): Promise<SyncBatch> => {
  const { ctx, stdout } = realContextFor(dir);
  await initHome(ctx);
  const refs = await seedUpstreams(dir, limit + QUEUED_REFS);
  // Explicit reverse target order distinguishes preserved request order from a sorted result.
  const keys = Object.keys(refs).toReversed();
  const broken = refs[keys[limit - 1] ?? ''];
  if (broken === undefined) {
    throw new Error('missing broken fixture');
  }
  await rm(new URL(broken.url), { force: true, recursive: true });
  await seedConfig(resolveHome(ctx.env), refs, { clone_mode: 'full' });
  return { brokenUrl: broken.url, ctx, keys, stdout };
};

/** Free the failed operation while its earlier siblings remain blocked. A queued clone must
 * start, proving failure releases a pipeline slot rather than waiting for the whole first wave. */
const checkFailedSlot = async (
  probe: CloneProbe,
  batch: SyncBatch,
  limit: number,
): Promise<void> => {
  await expect.poll(() => probe.gates.length, { timeout: POLL_TIMEOUT_MS }).toBe(limit);
  expect(probe.peak()).toBe(limit);
  const brokenGate = probe.gates.find((gate) => gate.url === batch.brokenUrl);
  expect(brokenGate).toBeDefined();
  brokenGate?.release();
  await expect.poll(() => probe.gates.length, { timeout: POLL_TIMEOUT_MS }).toBe(limit + 1);
  expect(probe.peak()).toBe(limit);
};

const checkBatchOutcome = async (batch: SyncBatch): Promise<void> => {
  const envelope = parseLastEnvelope(batch.stdout) as {
    data: { results: SyncResultItem[] };
    ok: boolean;
  };
  const state = await readState(resolveHome(batch.ctx.env));
  expect(process.exitCode).toBe(EXIT.UNEXPECTED);
  expect(envelope.ok).toBe(true);
  expect(envelope.data.results.map((result) => result.key)).toStrictEqual(batch.keys);
  expect(envelope.data.results.filter((result) => result.status === 'failed')).toHaveLength(1);
  expect(envelope.data.results.filter((result) => result.status === 'cloned')).toHaveLength(
    batch.keys.length - 1,
  );
  expect(Object.keys(state.refs).toSorted()).toStrictEqual(batch.keys.toSorted());
};

const exerciseSyncConcurrency = async (dir: string, scenario: SyncScenario): Promise<void> => {
  const batch = await prepareBatch(dir, scenario.limit);
  const probe = cloneProbe();
  const flags = scenario.count === undefined ? [] : ['--concurrency', scenario.count];
  const running = run({ ...batch.ctx, runner: probe.runner }, [
    'node',
    'refs',
    'sync',
    ...batch.keys,
    ...flags,
    '--json',
  ]);
  try {
    await checkFailedSlot(probe, batch, scenario.limit);
  } finally {
    probe.open();
    await running;
  }
  expect(probe.peak()).toBe(scenario.limit);
  await checkBatchOutcome(batch);
};

export { exerciseSyncConcurrency };
