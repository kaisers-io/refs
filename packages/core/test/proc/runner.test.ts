import {
  SIGNAL_KILLED_EXIT_CODE,
  SPAWN_ERROR_EXIT_CODE,
  SpawnRunner,
  TIMEOUT_EXIT_CODE,
} from '../../src/proc/runner.ts';
import { access, mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Real child-process integration suite for `SpawnRunner` — a hand-rolled `node:child_process`-
// based `Runner` that replaces `execa` (never a mock — this is the one place proving `run()`
// actually spawns, waits for, and (when asked) kills a real process rather than merely racing it).
// Includes the original timeout-normalization suite (fixes the review finding that a timed-out
// `ssh` probe kept running after `raceWithTimeout` gave up on it) plus new red-first coverage added
// while replacing `ExecaRunner`: non-zero exit as data, `ENOENT` resolving instead of throwing,
// full capture of large/interleaved output, signal-killed exit code normalization, and resolution
// waiting for the child's `close` event (streams drained) rather than its `exit` event.

const TEST_TIMEOUT_MS = 30_000;
const SUITE_OPTS = { timeout: TEST_TIMEOUT_MS };
const SHORT_TIMEOUT_MS = 100;
const RESOLVE_MARGIN_MS = 2000;
const KILL_CHECK_DELAY_MS = 1500;
const STDERR_NOTE_TIMEOUT_MS = 3000;
const SUCCESS_EXIT_CODE = 0;

// All children are `node -e` scripts run via `process.execPath` (never `sh`/`sleep`): the exact
// same binary with the exact same semantics on every platform, including Windows, where neither
// `sh` nor `sleep` is guaranteed to exist.
const HANG_5S_SCRIPT = 'setTimeout(() => {}, 5000);';
const WRITE_MARKER_AFTER_1S_SCRIPT =
  "setTimeout(() => { require('node:fs').writeFileSync(process.argv[1], ''); }, 1000);";

const runner = new SpawnRunner();

const runHang5sWithShortTimeout = (): ReturnType<SpawnRunner['run']> =>
  runner.run(process.execPath, ['-e', HANG_5S_SCRIPT], { timeoutMs: SHORT_TIMEOUT_MS });

describe('timeoutMs (SpawnRunner)', SUITE_OPTS, () => {
  it('resolves quickly with a normalized timeout result instead of waiting out the child', async () => {
    expect.hasAssertions();
    const start = Date.now();

    const result = await runHang5sWithShortTimeout();

    expect(Date.now() - start).toBeLessThan(RESOLVE_MARGIN_MS);
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
    expect(result.stderr).toContain('timed out');
  });

  it('actually kills the child rather than leaving it to finish in the background', async () => {
    expect.hasAssertions();
    const dir = await mkdtemp(join(tmpdir(), 'refs-runner-timeout-'));
    const marker = join(dir, 'done');

    await runner.run(process.execPath, ['-e', WRITE_MARKER_AFTER_1S_SCRIPT, marker], {
      timeoutMs: SHORT_TIMEOUT_MS,
    });
    // The child needs ~1s to reach its marker write; it was killed at ~100ms. If it had survived
    // instead of actually being killed, `marker` would exist well within this margin — its absence
    // is the proof the process is dead, not merely lost the race.
    await delay(KILL_CHECK_DELAY_MS);

    await expect(access(marker)).rejects.toThrow(/ENOENT/u);
  });

  it('sets timedOut true when this run() was killed by its own timeoutMs', async () => {
    expect.hasAssertions();

    const result = await runHang5sWithShortTimeout();

    expect(result.timedOut).toBe(true);
  });

  it('leaves timedOut unset for a real child that genuinely exits 124 on its own', async () => {
    expect.hasAssertions();

    const result = await runner.run(process.execPath, [
      '-e',
      `process.exit(${String(TIMEOUT_EXIT_CODE)});`,
    ]);

    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
    expect(result.timedOut).not.toBe(true);
  });
});

describe('timeout note joining (SpawnRunner)', SUITE_OPTS, () => {
  it('joins partial stderr ending in a newline to the timeout note with a SINGLE newline', async () => {
    expect.hasAssertions();

    // The child writes `partial\n` within its first few ms, then hangs — the direct child IS the
    // hang (no forked grandchild ever holds the stderr pipe open past the kill). The 3s timeout
    // is pure margin for the write to land under full parallel suite load (a 500ms margin was
    // empirically flaky there). The note must replace the trailing newline, not stack a blank
    // line on top of it (`partial\n\nrefs: ...`) — matching what the previous,
    // final-newline-stripping runner produced.
    const result = await runner.run(
      process.execPath,
      ['-e', String.raw`process.stderr.write('partial\n'); setTimeout(() => {}, 30000);`],
      { timeoutMs: STDERR_NOTE_TIMEOUT_MS },
    );

    expect(result.stderr).toBe(
      `partial\nrefs: command timed out after ${String(STDERR_NOTE_TIMEOUT_MS)}ms`,
    );
  });

  it('strips a CRLF terminator as one unit (no dangling carriage return before the note)', async () => {
    expect.hasAssertions();

    // Same construction as above, but the child's stderr ends in `\r\n` — the previous runner
    // stripped the CRLF pair as one terminator, so a dangling `\r` before the note would be a
    // silent behavior drift for CRLF-emitting children.
    const result = await runner.run(
      process.execPath,
      ['-e', String.raw`process.stderr.write('partial\r\n'); setTimeout(() => {}, 30000);`],
      { timeoutMs: STDERR_NOTE_TIMEOUT_MS },
    );

    expect(result.stderr).toBe(
      `partial\nrefs: command timed out after ${String(STDERR_NOTE_TIMEOUT_MS)}ms`,
    );
  });
});

describe('non-zero exit', () => {
  it('reports a non-zero exit as data instead of throwing', async () => {
    expect.hasAssertions();
    const EXPECTED_EXIT_CODE = 3;

    const result = await runner.run(process.execPath, [
      '-e',
      `process.exit(${String(EXPECTED_EXIT_CODE)});`,
    ]);

    expect(result.exitCode).toBe(EXPECTED_EXIT_CODE);
    expect(result.timedOut).not.toBe(true);
  });
});

describe('spawn failure (ENOENT)', () => {
  it('resolves instead of throwing when the binary does not exist', async () => {
    expect.hasAssertions();

    const result = await runner.run('refs-runner-test-no-such-binary', []);

    expect(result.exitCode).toBe(SPAWN_ERROR_EXIT_CODE);
    expect(result.stderr).toMatch(/ENOENT/u);
    expect(result.timedOut).not.toBe(true);
  });
});

describe('spawn failure (synchronous throw)', () => {
  it('resolves instead of rejecting when spawn() itself throws synchronously (empty cmd)', async () => {
    expect.hasAssertions();

    // `spawn('', [])` throws ERR_INVALID_ARG_VALUE SYNCHRONOUSLY — before any `error` event could
    // ever fire — so this pins the never-throw contract's last hole: no argument shape may escape
    // `run()` as a rejection. Unreachable from today's call sites (all pass literal 'git'/'ssh'),
    // but the `Runner` contract is frozen and the old execa-backed runner (reject: false) resolved
    // here too.
    const result = await runner.run('', []);

    expect(result.exitCode).toBe(SPAWN_ERROR_EXIT_CODE);
    expect(result.stderr).not.toBe('');
    expect(result.timedOut).not.toBe(true);
  });
});

describe('signal-killed (non-timeout)', () => {
  it('normalizes a self-inflicted SIGTERM to exitCode 1, never timedOut', async () => {
    expect.hasAssertions();

    // The child sends itself SIGTERM directly (never through our own `timeoutMs` machinery) —
    // exercises the plain "killed by signal" path `hardResetToBranch`-style callers never script.
    // On POSIX the child dies signal-killed (normalized to 1); on Windows libuv turns the
    // self-kill into a plain exit code 1 — the assertion is identical either way.
    const result = await runner.run(process.execPath, [
      '-e',
      "process.kill(process.pid, 'SIGTERM');",
    ]);

    expect(result.exitCode).toBe(SIGNAL_KILLED_EXIT_CODE);
    expect(result.timedOut).not.toBe(true);
  });
});

describe('large / interleaved output', () => {
  it('captures the full content of large, interleaved stdout and stderr writes', async () => {
    expect.hasAssertions();
    const CHUNK_COUNT = 400;
    const CHUNK_LENGTH = 512;
    const script = `
      const chunk = 'x'.repeat(${String(CHUNK_LENGTH)});
      for (let i = 0; i < ${String(CHUNK_COUNT)}; i += 1) {
        process.stdout.write(chunk);
        process.stderr.write(chunk);
      }
    `;

    const result = await runner.run(process.execPath, ['-e', script]);

    expect(result.exitCode).toBe(SUCCESS_EXIT_CODE);
    expect(result.stdout).toHaveLength(CHUNK_COUNT * CHUNK_LENGTH);
    expect(result.stderr).toHaveLength(CHUNK_COUNT * CHUNK_LENGTH);
  });
});

describe('resolution waits for close, not exit', () => {
  it('does not resolve until a backgrounded grandchild releases the inherited stdout pipe', async () => {
    expect.hasAssertions();
    const start = Date.now();
    const GRANDCHILD_DELAY_MS = 300;
    const MIN_ELAPSED_MS = 250;

    // The direct child exits ~immediately; a grandchild it spawned keeps the SAME inherited
    // stdout pipe open for another ~300ms. Node's `exit` event would fire as soon as the direct
    // child terminates; `close` (what `SpawnRunner` resolves on) waits for every process holding
    // that pipe open to release it — proving `run()` really waits for `close`, not `exit`.
    const grandchildScript = `setTimeout(() => { console.log('late-grandchild-output'); }, ${GRANDCHILD_DELAY_MS});`;
    const parentScript = [
      "const { spawn } = require('node:child_process');",
      `spawn(process.execPath, ['-e', ${JSON.stringify(grandchildScript)}], { stdio: 'inherit' });`,
      'process.exit(0);',
    ].join('\n');
    const result = await runner.run(process.execPath, ['-e', parentScript]);

    expect(Date.now() - start).toBeGreaterThanOrEqual(MIN_ELAPSED_MS);
    expect(result.stdout).toContain('late-grandchild-output');
  });
});
