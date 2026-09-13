import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { runInPty, slowGitDir } from './helpers/pty.ts';
import type { PtyRun } from './helpers/pty.ts';
import { SLOW_IO_TIMEOUT_MS } from './helpers/timeouts.ts';
import { createFixtureRepo } from './helpers/fixture-repo.ts';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

// The spinner on a real terminal, from the built bundle. A person at a terminal sees frames and a
// label that are cleared before the results; an agent never gets a byte of it, not under --json,
// not in a pipe, not when the environment says no; and Ctrl-C still ends the command and the git
// process it was waiting on. POSIX only: the pseudo-terminal comes from Python's `pty` module.

const exec = promisify(execFile);
const BIN = join(import.meta.dirname, '../bin/refs.mjs');
const CLEAR_LINE = '\r\u001B[K';
const BRAILLE = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u;
const ESCAPE = '\u001B';
const SIGINT_EXIT = -2;
const SLOW_STEP_SECONDS = 0.5;
const HANGING_SECONDS = 30;
const INTERRUPT_AFTER_MS = 2500;

const INHERITED_PATH = process.env['PATH'] ?? '';
const built: { build?: Promise<unknown> } = {};

// Every run of this file tests the code as it is now, never a bundle left over from an earlier
// build: `pnpm check` does not build.
const buildOnce = (): Promise<unknown> => {
  built.build ??= exec('pnpm', ['--filter', '@kaisers-io/refs', 'build'], {
    cwd: join(import.meta.dirname, '../../..'),
  });
  return built.build;
};

const gitWaiting = async (seconds: number): Promise<string> => {
  const { stdout } = await exec('sh', ['-c', 'command -v git']);
  return slowGitDir(stdout.trim(), seconds);
};

/** A fresh, initialized refs home on the built bundle, with a git that takes `gitDelaySeconds`. */
const setup = async (gitDelaySeconds: number): Promise<NodeJS.ProcessEnv> => {
  await buildOnce();
  const gitDir = await gitWaiting(gitDelaySeconds);
  const home = await mkdtemp(join(tmpdir(), 'refs-pty-home-'));
  const env = {
    HOME: home,
    LANG: 'en_US.UTF-8',
    PATH: `${gitDir}:${INHERITED_PATH}`,
    REFS_ALLOW_FILE_URLS: '1',
    REFS_HOME: join(home, 'refs'),
    REFS_UPDATE_CHECK: '0',
    TERM: 'xterm-256color',
  };
  await exec('node', [BIN, 'init'], { env });
  return env;
};

/** One configured ref, then `refs sync` on a terminal whose git never answers, and Ctrl-C. */
const ctrlCDuringSyncing = async (): Promise<{ gitDir: string; run: PtyRun }> => {
  const env = await setup(0);
  const fixture = await createFixtureRepo();
  await exec('node', [BIN, 'add', fixture.url, '--description', 'A fixture.', '--json'], { env });
  const gitDir = await gitWaiting(HANGING_SECONDS);
  const run = await runInPty({
    argv: ['node', BIN, 'sync'],
    env: { ...env, PATH: `${gitDir}:${INHERITED_PATH}` },
    interruptAfterMs: INTERRUPT_AFTER_MS,
  });
  return { gitDir, run };
};

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const livingPids = async (gitDir: string): Promise<number[]> => {
  const recorded = await readFile(join(gitDir, 'pids'), 'utf8');
  return recorded
    .trim()
    .split('\n')
    .map(Number)
    .filter((pid) => isAlive(pid));
};

const afterLastClear = (output: string): string => output.slice(output.lastIndexOf(CLEAR_LINE));

describe.skipIf(process.platform === 'win32')('the spinner on a real terminal', () => {
  it(
    'doctor shows frames and the running check, and clears them before the results',
    async () => {
      expect.hasAssertions();
      const env = await setup(SLOW_STEP_SECONDS);
      const { output } = await runInPty({ argv: ['node', BIN, 'doctor'], env });
      expect(output).toMatch(BRAILLE);
      expect(output).toContain('Checking Git');
      expect(afterLastClear(output)).not.toMatch(BRAILLE);
      expect(afterLastClear(output)).toContain('[OK] git:');
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'doctor --json prints the envelope and nothing else, even on a terminal',
    async () => {
      expect.hasAssertions();
      const env = await setup(SLOW_STEP_SECONDS);
      const { output } = await runInPty({ argv: ['node', BIN, 'doctor', '--json'], env });
      expect(output).not.toContain(ESCAPE);
      expect(output).not.toMatch(BRAILLE);
      expect(JSON.parse(output.trim())).toHaveProperty('ok', true);
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe.skipIf(process.platform === 'win32')('the spinner staying off', () => {
  it.each([
    ['REFS_PROGRESS=0', { REFS_PROGRESS: '0' }],
    ['TERM=dumb', { TERM: 'dumb' }],
    ['CI=true', { CI: 'true' }],
  ])(
    'doctor shows no spinner with %s',
    async (_name, overrides) => {
      expect.hasAssertions();
      const env = await setup(SLOW_STEP_SECONDS);
      const { output } = await runInPty({
        argv: ['node', BIN, 'doctor'],
        env: { ...env, ...overrides },
      });
      expect(output).not.toMatch(BRAILLE);
      expect(output).toContain('[OK] git:');
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'doctor shows no spinner when stderr is a pipe',
    async () => {
      expect.hasAssertions();
      const env = await setup(SLOW_STEP_SECONDS);
      const { stderr, stdout } = await exec('node', [BIN, 'doctor'], { env });
      expect(stderr).not.toMatch(BRAILLE);
      expect(stdout).toContain('[OK] git:');
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe.skipIf(process.platform === 'win32')('interrupting a spinning command', () => {
  it(
    'ctrl-c during sync still ends refs by SIGINT and takes its git process with it',
    async () => {
      expect.hasAssertions();
      const { gitDir, run } = await ctrlCDuringSyncing();
      expect(run.output).toMatch(BRAILLE);
      expect(run.exitCode).toBe(SIGINT_EXIT);
      await expect(livingPids(gitDir)).resolves.toStrictEqual([]);
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
