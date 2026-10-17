import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { SpawnRunner } from '@kaisers-io/refs-core';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { once } from 'node:events';
import { tmpdir } from 'node:os';

const UNAUTHORIZED = 401;
const SUCCESS = 200;
const EXECUTABLE = 0o700;
// Synthetic values accepted only by this test's loopback server, never real credentials.
const AUTHORIZATION = `Basic ${Buffer.from('fixture:fixture').toString('base64')}`;
const makeServer = (): { server: Server; authenticated: () => boolean } => {
  let authenticated = false;
  const server = createServer((request, response) => {
    if (request.headers.authorization !== AUTHORIZATION) {
      response.writeHead(UNAUTHORIZED, { 'WWW-Authenticate': 'Basic realm="fixture"' });
      response.end();
      return;
    }
    authenticated = true;
    response.writeHead(SUCCESS, { 'Content-Type': 'text/plain' });
    response.end(request.url?.endsWith('/HEAD') === true ? 'ref: refs/heads/main\n' : '');
  });
  return { authenticated: () => authenticated, server };
};

const serverUrl = (server: Server): string => {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('no loopback port');
  }
  return `http://127.0.0.1:${String(address.port)}/repo.git`;
};

const setEnvironment = (config: string): void => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CONFIG_COUNT', '0');
  // eslint-disable-next-line unicorn/no-useless-undefined -- prove refs supplies its own default
  vi.stubEnv('GIT_TERMINAL_PROMPT', undefined);
};

const prepareAuth = async (mode: string, dir: string): Promise<void> => {
  const config = join(dir, 'gitconfig');
  await writeFile(config, '');
  setEnvironment(config);
  if (mode === 'helper') {
    await writeFile(
      config,
      '[credential]\n helper = "!f() { echo username=fixture; echo password=fixture; }; f"\n',
    );
  } else {
    const askpass = join(dir, 'askpass.sh');
    await writeFile(askpass, '#!/bin/sh\nprintf "%s\\n" fixture\n');
    await chmod(askpass, EXECUTABLE);
    vi.stubEnv('GIT_ASKPASS', askpass);
  }
};

const cleanUp = async (server: Server, dir: string): Promise<void> => {
  server.closeAllConnections();
  server.close();
  vi.unstubAllEnvs();
  await rm(dir, { force: true, recursive: true });
};

const exerciseAuth = async (mode: string): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-auth-'));
  const fixture = makeServer();
  fixture.server.listen(0, '127.0.0.1');
  await once(fixture.server, 'listening');
  try {
    await prepareAuth(mode, dir);
    const result = await new SpawnRunner().run('git', ['ls-remote', serverUrl(fixture.server)]);
    expect(result).toMatchObject({ exitCode: 0, stdout: '' });
    expect(fixture.authenticated()).toBe(true);
  } finally {
    await cleanUp(fixture.server, dir);
  }
};

describe('real noninteractive Git authentication', () => {
  it.each(['helper', 'askpass'])(
    'authenticates successfully using an existing %s',
    async (mode) => {
      expect.hasAssertions();
      await exerciseAuth(mode);
    },
  );
});
