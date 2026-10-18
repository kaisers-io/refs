import { describe, expect, it, onTestFinished } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { taskkillPath } from '../../src/proc/spawn-timeout.ts';
import { tmpdir } from 'node:os';

// git starts helpers (`git-remote-http`, `index-pack`, ssh) that inherit its output pipes. When a
// deadline stops git and a helper is still blocked on a server that never answers, the pipes never
// close: stopping git alone left `run()` waiting forever. These children stand in for that: the
// direct child starts a grandchild on the same pipes and both wait indefinitely.

const DEADLINE_MS = 500;
const WITHIN_MS = 10_000;
const SUITE_OPTS = { timeout: 30_000 };
const POLL_MS = 50;

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Polls until `pid` is gone or `WITHIN_MS` passes; resolves to whether it is gone. */
const goneSoon = async (pid: number, started = Date.now()): Promise<boolean> => {
  while (isAlive(pid) && Date.now() - started < WITHIN_MS) {
    // oxlint-disable-next-line no-await-in-loop -- polling one process until it is gone
    await delay(POLL_MS);
  }
  return !isAlive(pid);
};

const helperScript = (pidFile: string): string =>
  [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    "const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });",
    `writeFileSync(${JSON.stringify(pidFile)}, String(helper.pid));`,
    'setInterval(() => {}, 1000);',
  ].join('\n');

describe('a deadline on a child whose helper holds its pipes', SUITE_OPTS, () => {
  it('stops the helper too, so the run resolves instead of waiting forever', async () => {
    expect.hasAssertions();
    const dir = await mkdtemp(join(tmpdir(), 'refs-tree-'));
    onTestFinished(() => rm(dir, { force: true, recursive: true }));
    const pidFile = join(dir, 'helper.pid');
    const started = Date.now();

    const result = await new SpawnRunner().run(process.execPath, ['-e', helperScript(pidFile)], {
      timeoutMs: DEADLINE_MS,
    });

    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(WITHIN_MS);
    const helperPid = Number(await readFile(pidFile, 'utf8'));
    await expect(goneSoon(helperPid)).resolves.toBe(true);
  });
});

const GROUP_CHILD = fileURLToPath(
  new URL('../helpers/spawn-runner-group-cleanup-child.mjs', import.meta.url),
);

/** Resolves to the content of `path` once it exists and is non-empty, polling. */
const readWhenWritten = async (path: string, started = Date.now()): Promise<string> => {
  const size = await stat(path).then(
    (info) => info.size,
    () => 0,
  );
  if (size > 0 || Date.now() - started > WITHIN_MS) {
    return readFile(path, 'utf8');
  }
  await delay(POLL_MS);
  return readWhenWritten(path, started);
};

// A child with a deadline leads its own process group, which a terminal's Ctrl-C does not reach;
// refs' own signal cleanup has to stop the group. Windows: no group, and a console Ctrl-C reaches
// the whole console process tree already.
describe('refs signalled while a deadline command runs', SUITE_OPTS, () => {
  it.skipIf(process.platform === 'win32')('stops the helpers of that command too', async () => {
    expect.hasAssertions();
    const dir = await mkdtemp(join(tmpdir(), 'refs-tree-'));
    onTestFinished(() => rm(dir, { force: true, recursive: true }));
    const pidFile = join(dir, 'helper.pid');
    const host = spawn(process.execPath, [GROUP_CHILD, pidFile], { stdio: 'ignore' });
    const helperPid = Number(await readWhenWritten(pidFile));

    host.kill('SIGTERM');

    await expect(goneSoon(helperPid)).resolves.toBe(true);
  });
});

// taskkill is started by absolute path: a checkout, the working directory, can hold a taskkill.exe.
describe('where the Windows tree kill comes from', () => {
  it('is System32 under an absolute SystemRoot, and nothing otherwise', () => {
    expect.hasAssertions();
    expect(taskkillPath({ SystemRoot: String.raw`C:\Windows` })).toBe(
      String.raw`C:\Windows\System32\taskkill.exe`,
    );
    expect(taskkillPath({ SYSTEMROOT: 'D:/Win' })).toBe(String.raw`D:\Win\System32\taskkill.exe`);
    expect(taskkillPath({ SystemRoot: 'Windows' })).toBeUndefined();
    expect(taskkillPath({ SystemRoot: '' })).toBeUndefined();
    expect(taskkillPath({})).toBeUndefined();
  });
});
