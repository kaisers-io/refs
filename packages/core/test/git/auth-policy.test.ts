import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { cloneRepo } from '../../src/git/repo.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { once } from 'node:events';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const UNAUTHORIZED = 401;
const NOT_FOUND = 404;
const TEST_TIMEOUT_MS = 20_000;
const ENCODING = 'utf8';
const FIXTURE_AUTH = `Basic ${Buffer.from('fixture:fixture-only').toString('base64')}`;

const serveFile = async (
  request: IncomingMessage,
  response: ServerResponse,
  gitDir: string,
): Promise<void> => {
  if (request.headers.authorization !== FIXTURE_AUTH) {
    response.writeHead(UNAUTHORIZED, { 'WWW-Authenticate': 'Basic realm="local fixture"' });
    response.end();
    return;
  }
  try {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    response.end(await readFile(join(gitDir, path)));
  } catch {
    response.writeHead(NOT_FOUND);
    response.end();
  }
};

const serve = async (gitDir: string): Promise<Server> => {
  const server = createServer((request, response) => {
    void serveFile(request, response, gitDir);
  });
  await once(server.listen(0, '127.0.0.1'), 'listening');
  return server;
};

const serverUrl = (server: Server): string => {
  const address = server.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('fixture HTTP server did not bind a port');
  }
  return `http://127.0.0.1:${address.port}`;
};

const setupAuth = async (root: string): Promise<string> => {
  const helper = join(root, 'credential.mjs');
  const marker = join(root, 'helper-called');
  const config = join(root, 'config');
  await writeFile(
    helper,
    `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(marker)}, 'called'); ` +
      "process.stdout.write('username=fixture\\npassword=fixture-only\\n\\n');\n",
  );
  await exec('git', [
    'config',
    '--file',
    config,
    'credential.helper',
    `!"${process.execPath.replaceAll('\\', '/')}" "${helper.replaceAll('\\', '/')}"`,
  ]);
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_TERMINAL_PROMPT', '0');
  return marker;
};

const runAuthenticatedClone = async (root: string, server: Server): Promise<void> => {
  const marker = await setupAuth(root);
  await expect(
    cloneRepo(new SpawnRunner(), {
      cloneUrl: serverUrl(server),
      dest: join(root, 'checkout'),
      hooksDir: join(root, 'hooks'),
      mode: 'full',
    }),
  ).resolves.toStrictEqual({ effectiveMode: 'full' });
  await expect(readFile(marker, ENCODING)).resolves.toContain('called');
  await expect(readFile(join(root, 'checkout', 'README.md'), ENCODING)).resolves.toBe(
    '# fixture repo\n',
  );
};

describe('trusted external authentication remains usable', () => {
  it(
    'clones through an external credential helper using only synthetic local HTTP credentials',
    async () => {
      expect.hasAssertions();
      const source = await createFixtureRepo();
      const root = await mkdtemp(join(source.dir, '..', 'refs-auth-policy-'));
      await exec('git', ['update-server-info'], { cwd: source.dir });
      const server = await serve(join(source.dir, '.git'));
      try {
        await runAuthenticatedClone(root, server);
      } finally {
        vi.unstubAllEnvs();
        await server[Symbol.asyncDispose]();
        await Promise.all(
          [root, source.dir].map((path) => rm(path, { force: true, recursive: true })),
        );
      }
    },
    TEST_TIMEOUT_MS,
  );
});
