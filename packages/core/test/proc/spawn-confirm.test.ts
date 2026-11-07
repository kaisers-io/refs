import { describe, expect, it } from 'vitest';
import type { Exec } from '../../src/proc/spawn-tree.ts';
import type { RunResult } from '../../src/proc/runner.ts';
import { treeEnded } from '../../src/proc/spawn-confirm.ts';

// The decision half of confirming a timed-out tree ended (spawn-confirm.ts), against a scripted
// `ps`. The test process's own pid stands in for a descendant that still exists: it is the one pid
// guaranteed to answer a signal-0 probe. The real-process half is runner-timeout-survivors.test.ts.

const OURS = process.pid;
// A pid that cannot exist, so the signal-0 probe answers ESRCH.
const IMPOSSIBLE_PID = 1_073_741_824;
const FAILED = 1;
const NO_WAIT = 0;

const psAnswering = (result: Partial<RunResult>): Exec => {
  const full: RunResult = { exitCode: 0, stderr: '', stdout: '', ...result };
  return () => Promise.resolve(full);
};

const target = (exec: Exec, seen: number[], rootAlive = false) => ({
  exec,
  pid: IMPOSSIBLE_PID,
  platform: process.platform,
  rootAlive: () => rootAlive,
  seen: new Set(seen),
  systemRoot: undefined,
});

describe('confirming a timed-out tree ended', () => {
  it('is not ended while the direct child runs', async () => {
    expect.hasAssertions();
    const running = target(psAnswering({}), [], true);
    await expect(treeEnded(running, NO_WAIT)).resolves.toBe(false);
  });

  it('is ended when no seen descendant exists any more, without asking ps', async () => {
    expect.hasAssertions();
    const exec = psAnswering({ exitCode: FAILED });
    await expect(treeEnded(target(exec, [IMPOSSIBLE_PID]), NO_WAIT)).resolves.toBe(true);
  });

  it('counts a descendant ps lists as a zombie as ended', async () => {
    expect.hasAssertions();
    const exec = psAnswering({ stdout: `  1 Ss\n  ${String(OURS)} Z+\n` });
    await expect(treeEnded(target(exec, [OURS]), NO_WAIT)).resolves.toBe(true);
  });

  it('counts a descendant ps lists as running as a survivor', async () => {
    expect.hasAssertions();
    const exec = psAnswering({ stdout: `  ${String(OURS)} S\n  999 Z\n` });
    await expect(treeEnded(target(exec, [OURS]), NO_WAIT)).resolves.toBe(false);
  });

  it('confirms nothing when ps fails while a descendant still exists', async () => {
    expect.hasAssertions();
    const exec = psAnswering({ exitCode: FAILED });
    await expect(treeEnded(target(exec, [OURS]), NO_WAIT)).resolves.toBe(false);
  });
});
