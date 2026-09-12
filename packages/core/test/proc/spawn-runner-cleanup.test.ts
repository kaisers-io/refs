import { access, mkdtemp, rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { ChildProcess } from 'node:child_process';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

// Parent-death cleanup suite (task brief requirement 7): when the process HOSTING a `SpawnRunner`
// is itself killed by SIGINT/SIGTERM/SIGHUP mid-`run()`, the real child that `run()` is waiting on
// must not survive as an orphan. Exercised via a real three-process chain — this test process,
// a "middle" node process (`spawn-runner-cleanup-child.mjs`, a stand-in for a `refs` CLI
// invocation) that calls `SpawnRunner#run()` on a long `sleep`, and the `sleep` itself — because
// the cleanup this proves (`spawn-cleanup.ts`'s signal handlers) only fires in the real process
// that installed it; a mock or in-process fake could never demonstrate the actual OS-level effect.

const execFileAsync = promisify(execFile);

const CHILD_SCRIPT = fileURLToPath(
  new URL('../helpers/spawn-runner-cleanup-child.mjs', import.meta.url),
);
const POLL_INTERVAL_MS = 50;
const MARKER_TIMEOUT_MS = 5000;
const DEATH_TIMEOUT_MS = 5000;
const PROBE_SIGNAL = 0;

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, PROBE_SIGNAL);
    return true;
  } catch {
    return false;
  }
};

// Polls `check` every `POLL_INTERVAL_MS` until it reports `true` or `timeoutMs` elapses — plain
// wall-clock polling (no fs watcher/signal) since what's being awaited (a file appearing, a PID
// disappearing) crosses real OS process boundaries this test doesn't otherwise get an event for.
const waitUntil = async (
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- sequential polling by design, see comment above
    if (await check()) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error('waitUntil: condition never became true within the timeout');
    }
    // eslint-disable-next-line no-await-in-loop -- sequential polling by design, see comment above
    await delay(POLL_INTERVAL_MS);
  }
};

// The middle process's direct child (the marker-then-hang `node -e` `SpawnRunner` started) —
// found via the OS process table (`pgrep -P` on POSIX, CIM on Windows), never captured from the
// middle process's own stdout, so this stays a black-box assertion on real OS process state
// rather than trusting the thing under test to self-report correctly.
const firstPidLine = (stdout: string): number | undefined => {
  const [firstLine] = stdout.trim().split(/\r?\n/u);
  return firstLine === undefined || firstLine === '' ? undefined : Number(firstLine);
};

// How the query would be written by hand, for the timeout message — the reader needs to know which
// process table was asked about which pid.
const childQueryFor = (parentPid: number): string =>
  process.platform === 'win32'
    ? `CIM children of ${String(parentPid)}`
    : `pgrep -P ${String(parentPid)}`;

/** One look at the process table: the direct child's pid, or `undefined` when the table does not
 * (yet) show one. Both "no match" shapes collapse to `undefined` — Windows returns empty stdout,
 * `pgrep` exits non-zero, which rejects — because the caller polls and only the eventual absence
 * of a child is a failure. */
const tryDirectChildPid = async (parentPid: number): Promise<number | undefined> => {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${String(parentPid)}").ProcessId`,
      ]);
      return firstPidLine(stdout);
    }
    const { stdout } = await execFileAsync('pgrep', ['-P', String(parentPid)]);
    return firstPidLine(stdout);
  } catch {
    return undefined;
  }
};

/** The direct child's pid, polled like every other cross-process wait in this file.
 *
 * The grandchild's marker file proves it reached its own code; it does NOT prove the OS process
 * table has caught up, and on a loaded hosted runner the CIM query is not instantaneous. Reading
 * once turned that lag into a red Windows check that passed on re-run (#84). Polling asserts on
 * the same real OS state, just not on a snapshot taken before it exists — a child that never
 * appears still fails, with the same message it always did. */
const directChildPid = async (parentPid: number, timeoutMs: number): Promise<number> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- sequential polling by design, as in `waitUntil`
    const pid = await tryDirectChildPid(parentPid);
    if (pid !== undefined) {
      return pid;
    }
    if (Date.now() >= deadline) {
      throw new Error(`${childQueryFor(parentPid)}: no child found`);
    }
    // eslint-disable-next-line no-await-in-loop -- sequential polling by design, as in `waitUntil`
    await delay(POLL_INTERVAL_MS);
  }
};

// The signal the test delivers to the middle process. On POSIX, SIGTERM exercises the classic
// catchable-termination path. On Windows, `ChildProcess#kill('SIGTERM')` is an unconditional
// TerminateProcess (handlers never run), so the only *injectable* catchable signal is SIGBREAK
// (Ctrl-Break via a console ctrl event) — which `spawn-cleanup.ts` handles on Windows.
const CATCHABLE_KILL_SIGNAL: NodeJS.Signals = process.platform === 'win32' ? 'SIGBREAK' : 'SIGTERM';

const requireMiddlePid = (child: ChildProcess): number => {
  const { pid } = child;
  if (pid === undefined) {
    throw new Error('middle process failed to spawn');
  }
  return pid;
};

type Scenario = {
  childAliveBeforeKill: boolean;
  childAliveAfterKill: boolean;
};

// Spawns the middle process, waits for its hang-holding child to actually start, kills the
// middle process, then waits for that child to die — split out of the `it` body purely to keep
// both this function's and the test's own statement counts under the repo's `max-statements` cap,
// and to keep the pid-undefined guard (`requireMiddlePid`) out of the test body entirely (the
// `vitest/no-conditional-in-test` rule disallows branching directly inside an `it()` callback).
const runParentDeathScenario = async (dir: string): Promise<Scenario> => {
  const marker = join(dir, 'grandchild-started');
  const middle = spawn(process.execPath, [CHILD_SCRIPT, marker], { stdio: 'ignore' });
  const middlePid = requireMiddlePid(middle);

  await waitUntil(() => fileExists(marker), MARKER_TIMEOUT_MS);
  const childPid = await directChildPid(middlePid, MARKER_TIMEOUT_MS);
  const childAliveBeforeKill = isPidAlive(childPid);

  middle.kill(CATCHABLE_KILL_SIGNAL);
  await waitUntil(() => !isPidAlive(childPid), DEATH_TIMEOUT_MS);

  return { childAliveAfterKill: isPidAlive(childPid), childAliveBeforeKill };
};

describe('parent-death cleanup', { timeout: SLOW_IO_TIMEOUT_MS }, () => {
  it('kills the real child a SpawnRunner#run() is waiting on when the host process gets a catchable termination signal', async () => {
    expect.hasAssertions();
    const dir = await mkdtemp(join(tmpdir(), 'refs-spawn-cleanup-'));

    try {
      const scenario = await runParentDeathScenario(dir);
      expect(scenario.childAliveBeforeKill).toBe(true);
      expect(scenario.childAliveAfterKill).toBe(false);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
