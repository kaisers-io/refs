import {
  REMOTE_BASE,
  homeRoutingTo,
  stalledRemote,
  unauthorizedRemote,
} from './helpers/loopback-remotes.ts';
import { describe, expect, it } from 'vitest';
import { SLOW_IO_TIMEOUT_MS } from './helpers/timeouts.ts';
import { cliBundle } from './helpers/printed-command.ts';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { runInPty } from './helpers/pty.ts';
import { stat } from 'node:fs/promises';

// Network git operations that nobody can finish must END, from the built bundle and real git: a
// credential prompt on a terminal (git reads `/dev/tty`, not refs' ignored stdin), and a server
// that accepts the connection and never answers. POSIX only: the prompt case needs a
// pseudo-terminal, and the other looks for leftover processes with `ps`.

const run = promisify(execFile);
const SOURCE = `${REMOTE_BASE}owner/repo.git`;
const DEST_PARTS = ['sources', 'refs-bounds.example.com', 'owner', 'repo'];
const VALIDATION_EXIT = 3;
// Ctrl-C after this long, so a prompt that is shown ends the test instead of hanging it.
const INTERRUPT_BACKSTOP_MS = 10_000;
const PROMPT_BOUND_MS = 8000;
const TIMEOUT_SECONDS = '1';
const TIMEOUT_BOUND_MS = 10_000;

type Attempt = { elapsedMs: number; stdout: string };

/** An initialized refs home in a HOME that routes the remote to `port`. */
const refsEnvFor = async (port: number): Promise<Record<string, string>> => {
  const home = await homeRoutingTo(port);
  const env = {
    HOME: home,
    LANG: 'en_US.UTF-8',
    PATH: process.env['PATH'] ?? '',
    REFS_HOME: join(home, 'refs'),
    REFS_UPDATE_CHECK: '0',
    TERM: 'xterm-256color',
  };
  await run('node', [await cliBundle(), 'init'], { env });
  return env;
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

/** Command lines of the running processes that contain `text`. */
const processesMentioning = async (text: string): Promise<string[]> => {
  const { stdout } = await run('ps', ['-A', '-o', 'args=']);
  return stdout.split('\n').filter((line) => line.includes(text));
};

/** `refs add --dry-run --json` without a terminal: its envelope and how long it took. */
const timedAdd = async (env: Record<string, string>): Promise<Attempt> => {
  const started = Date.now();
  try {
    const { stdout } = await run(
      'node',
      [await cliBundle(), 'add', SOURCE, '--dry-run', '--json'],
      {
        env,
      },
    );
    return { elapsedMs: Date.now() - started, stdout };
  } catch (error) {
    return { elapsedMs: Date.now() - started, stdout: (error as { stdout: string }).stdout };
  }
};

/** The same add on a pseudo-terminal, as a person at a terminal would run it. */
const addOnTerminal = async (
  port: number,
): Promise<{ elapsedMs: number; exitCode: number; output: string }> => {
  const env = await refsEnvFor(port);
  const started = Date.now();
  const result = await runInPty({
    argv: ['node', await cliBundle(), 'add', SOURCE, '--dry-run', '--json'],
    env,
    interruptAfterMs: INTERRUPT_BACKSTOP_MS,
  });
  return { ...result, elapsedMs: Date.now() - started };
};

/** Two adds in a row with a 1s command timeout, and the home they ran in. */
const twoTimedOutAdds = async (
  port: number,
): Promise<{ attempts: Attempt[]; refsHome: string }> => {
  const env: Record<string, string> = {
    ...(await refsEnvFor(port)),
    REFS_GIT_TIMEOUT: TIMEOUT_SECONDS,
  };
  // A second attempt straight away: a lock still held, or a half-made checkout, would change it.
  const attempts = [await timedAdd(env), await timedAdd(env)];
  return { attempts, refsHome: env['REFS_HOME'] ?? '' };
};

describe.skipIf(process.platform === 'win32')('network git operations that cannot finish', () => {
  it(
    'fails at a credential prompt on a terminal instead of waiting at it, and says what to do',
    async () => {
      expect.hasAssertions();
      const remote = await unauthorizedRemote();
      const result = await addOnTerminal(remote.port).finally(remote.close);
      expect(result.elapsedMs).toBeLessThan(PROMPT_BOUND_MS);
      // git's own prompt starts a line; its error quotes the same words mid-line.
      expect(result.output).not.toMatch(/^Username for /mu);
      expect(result.output).toContain('terminal prompts disabled');
      expect(result.output).toContain('credential helper');
      expect(result.exitCode).toBe(VALIDATION_EXIT);
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'ends a clone of a server that never answers at REFS_GIT_TIMEOUT, leaving no checkout and no lock',
    async () => {
      expect.hasAssertions();
      const remote = await stalledRemote();
      const { attempts, refsHome } = await twoTimedOutAdds(remote.port).finally(remote.close);
      expect(attempts.map((attempt) => attempt.elapsedMs < TIMEOUT_BOUND_MS)).toStrictEqual([
        true,
        true,
      ]);
      expect(attempts.map((attempt) => attempt.stdout.includes('REFS_GIT_TIMEOUT'))).toStrictEqual([
        true,
        true,
      ]);
      expect(attempts[0]?.stdout).toContain('timed out after 1000ms');
      await expect(exists(join(refsHome, ...DEST_PARTS))).resolves.toBe(false);
      // git's transport helpers for this remote, which used to outlive the git they served.
      await expect(processesMentioning(`127.0.0.1:${String(remote.port)}/`)).resolves.toStrictEqual(
        [],
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
