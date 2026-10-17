import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { RunResult } from '../../src/proc/runner.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DEADLINE_MS = 1000;
const MAX_DURATION_MS = 6000;
const OBSERVE_MS = 100;
const FIXTURE_EXIT_MS = 10_000;
const GRANDCHILD = `
  const fs = require('node:fs');
  process.on('SIGTERM', () => {});
  fs.writeFileSync(process.argv[1], 'started');
  setInterval(() => fs.appendFileSync(process.argv[1], 'x'), 10);
  setTimeout(() => process.exit(0), 9000);
`;
const parentScript = (inherited: boolean): string => `
  const { spawn } = require('node:child_process');
  spawn(process.execPath, ['-e', ${JSON.stringify(GRANDCHILD)}, process.argv[1]],
    { stdio: ${JSON.stringify(inherited ? 'inherit' : 'ignore')} });
  setTimeout(() => process.exit(0), 9000);
`;

const expectStopped = async (marker: string): Promise<void> => {
  await expect(access(marker)).resolves.toBeUndefined();
  const stopped = await readFile(marker, 'utf8');
  await delay(OBSERVE_MS);
  await expect(readFile(marker, 'utf8')).resolves.toBe(stopped);
};

const exerciseTree = async (inherited: boolean): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-process-tree-'));
  const marker = join(dir, 'writer');
  const started = Date.now();
  try {
    const result = await new SpawnRunner().run(
      process.execPath,
      ['-e', parentScript(inherited), marker],
      { timeoutMs: DEADLINE_MS },
    );
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(MAX_DURATION_MS);
    await expectStopped(marker);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
};

// A non-detached Node grandchild is automatically killed by its Node parent's Windows job.
// Bypass that fixture-only job while retaining the inherited pipes, as a native Git helper can.
const EARLY_EXIT_PARENT = `
  const { spawn } = require('node:child_process');
  const fs = require('node:fs');
  spawn(process.execPath, ['-e', ${JSON.stringify(GRANDCHILD)}, process.argv[1]],
    { detached: process.platform === 'win32', stdio: 'inherit' });
  setInterval(() => {
    if (fs.existsSync(process.argv[1]) && fs.readFileSync(process.argv[1], 'utf8').includes('x')) {
      process.exit(0);
    }
  }, 10);
`;

const expectUnconfirmedWriter = async (result: RunResult, marker: string): Promise<void> => {
  expect(result.terminationFailed).toBe(true);
  expect(result.stderr).toContain('direct child already exited');
  const before = await readFile(marker, 'utf8');
  await delay(OBSERVE_MS);
  const after = await readFile(marker, 'utf8');
  expect(after.length).toBeGreaterThan(before.length);
};

const expectExitedParent = async (
  result: RunResult,
  marker: string,
  started: number,
): Promise<void> => {
  expect(result.timedOut).toBe(true);
  expect(Date.now() - started).toBeLessThan(MAX_DURATION_MS);
  await (process.platform === 'win32'
    ? expectUnconfirmedWriter(result, marker)
    : expectStopped(marker));
};

const exerciseExitedParent = async (): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-exited-parent-'));
  const marker = join(dir, 'writer');
  const started = Date.now();
  try {
    const result = await new SpawnRunner().run(
      process.execPath,
      ['-e', EARLY_EXIT_PARENT, marker],
      { timeoutMs: DEADLINE_MS },
    );
    await expectExitedParent(result, marker, started);
  } finally {
    // Windows cannot safely target an exited root PID. This bounded fixture exits itself;
    // keep its files until then instead of racing the still-running descendant writer.
    if (process.platform === 'win32') {
      await delay(FIXTURE_EXIT_MS);
    }
    await rm(dir, { force: true, recursive: true });
  }
};

describe('owned subprocess tree cancellation', { timeout: SLOW_IO_TIMEOUT_MS }, () => {
  it('bounds an exited parent with a descendant retaining its pipes and writing files', async () => {
    expect.hasAssertions();
    await exerciseExitedParent();
  });

  it.each([true, false])(
    'stops descendant writers before resolving (inherited pipes: %s)',
    async (inherited) => {
      expect.hasAssertions();
      await exerciseTree(inherited);
    },
  );
});
