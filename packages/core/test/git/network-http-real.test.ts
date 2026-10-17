import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Server } from 'node:http';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { cloneRepo } from '../../src/git/repo.ts';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { once } from 'node:events';
import { tmpdir } from 'node:os';

// Real git against a loopback HTTP server, on every platform (the ssh-stub cases next door need a
// POSIX shell). refs turns git's terminal prompt off; these pin that the ways a user really
// authenticates (a credential helper, GIT_ASKPASS) still work under it, that a missing credential
// fails at once instead of waiting, and that a server which stops answering is stopped by the
// deadline. The credentials are synthetic and only this test's server accepts them.

const UNAUTHORIZED = 401;
const OK = 200;
const SCRIPT_MODE = 0o755;
const SUCCESS_EXIT_CODE = 0;
const DEADLINE_MS = 500;
const WITHIN_MS = 15_000;
const SUITE_OPTS = { timeout: 30_000 };
const AUTHORIZATION = `Basic ${Buffer.from('fixture:fixture').toString('base64')}`;
const IS_WINDOWS = process.platform === 'win32';

const runner = new SpawnRunner();

const scratch = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-http-'));
  onTestFinished(() => rm(dir, { force: true, recursive: true }));
  return dir;
};

/** Listens on loopback; closes with the test. Resolves to the repository URL. */
const serve = async (server: Server): Promise<string> => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return `http://127.0.0.1:${String(port)}/repo.git`;
};

/** Answers 401 until it sees the fixture credential, then an empty (dumb, ref-less) repository. */
const authServer = (): { server: Server; authenticated: () => boolean } => {
  let authenticated = false;
  const server = createServer((request, response) => {
    if (request.headers.authorization !== AUTHORIZATION) {
      response.writeHead(UNAUTHORIZED, { 'WWW-Authenticate': 'Basic realm="fixture"' });
      response.end();
      return;
    }
    authenticated = true;
    response.writeHead(OK, { 'Content-Type': 'text/plain' });
    response.end();
  });
  return { authenticated: () => authenticated, server };
};

/** Removes `name` from the environment for the rest of the test. */
const unsetEnv = (name: string): void => {
  const previous = process.env[name];
  Reflect.deleteProperty(process.env, name);
  onTestFinished(() => {
    if (previous !== undefined) {
      process.env[name] = previous;
    }
  });
};

/** git with no user or system configuration, the prompt setting left to refs, plus `config`. */
const isolatedGit = async (dir: string, config = ''): Promise<void> => {
  const global = join(dir, 'gitconfig');
  await writeFile(global, config);
  vi.stubEnv('GIT_CONFIG_GLOBAL', global);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  for (const name of ['GIT_TERMINAL_PROMPT', 'GIT_ASKPASS', 'SSH_ASKPASS']) {
    unsetEnv(name);
  }
};

/** Isolated git whose only credential source is a GIT_ASKPASS program answering `fixture`. */
const withAskpass = async (dir: string): Promise<void> => {
  await isolatedGit(dir);
  const askpass = join(dir, 'askpass');
  await writeFile(askpass, '#!/bin/sh\necho fixture\n');
  await chmod(askpass, SCRIPT_MODE);
  vi.stubEnv('GIT_ASKPASS', askpass);
};

const lsRemote = (url: string): ReturnType<SpawnRunner['run']> =>
  runner.run('git', ['ls-remote', url], { timeoutMs: WITHIN_MS });

describe('authenticating over https-style transports', SUITE_OPTS, () => {
  it('still uses a configured credential helper', async () => {
    expect.hasAssertions();
    const fixture = authServer();
    const url = await serve(fixture.server);
    const helper = '!f() { echo username=fixture; echo password=fixture; }; f';
    await isolatedGit(await scratch(), `[credential]\n\thelper = "${helper}"\n`);

    const result = await lsRemote(url);

    expect(result).toMatchObject({ exitCode: SUCCESS_EXIT_CODE, stdout: '' });
    expect(fixture.authenticated()).toBe(true);
  });

  // GIT_ASKPASS names a program git runs directly; a shebang script is a POSIX program.
  it.skipIf(IS_WINDOWS)('still uses GIT_ASKPASS', async () => {
    expect.hasAssertions();
    const fixture = authServer();
    const url = await serve(fixture.server);
    await withAskpass(await scratch());

    const result = await lsRemote(url);

    expect(result).toMatchObject({ exitCode: SUCCESS_EXIT_CODE, stdout: '' });
    expect(fixture.authenticated()).toBe(true);
  });

  it('fails at once, without a prompt, when nothing supplies a credential', async () => {
    expect.hasAssertions();
    const fixture = authServer();
    const url = await serve(fixture.server);
    await isolatedGit(await scratch());

    const result = await lsRemote(url);

    expect(result.timedOut).toBeUndefined();
    expect(result.exitCode).not.toBe(SUCCESS_EXIT_CODE);
    expect(result.stderr).toContain('terminal prompts disabled');
    expect(fixture.authenticated()).toBe(false);
  });
});

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const stalledClone = async (url: string, dest: string): Promise<void> => {
  await cloneRepo(runner, {
    cloneUrl: url,
    dest,
    hooksDir: join(dest, '..', 'hooks'),
    mode: 'full',
    networkTimeoutMs: DEADLINE_MS,
  });
};

describe('a server that accepts the request and never answers', SUITE_OPTS, () => {
  it('stops the clone at the deadline and leaves no checkout behind', async () => {
    expect.hasAssertions();
    // Holds every request open: no response is ever sent.
    const url = await serve(createServer(() => {}));
    const dir = await scratch();
    await isolatedGit(dir);
    const dest = join(dir, 'checkout');
    const started = Date.now();

    await expect(stalledClone(url, dest)).rejects.toThrow(
      'git clone timed out after 0.5s (REFS_NETWORK_TIMEOUT) and was stopped',
    );

    expect(Date.now() - started).toBeLessThan(WITHIN_MS);
    await expect(exists(dest)).resolves.toBe(false);
  });
});
