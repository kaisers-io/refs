import { describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { terminateProcessTree } from '../../src/proc/process-tree.ts';

vi.mock(import('node:child_process'));
const mocked = { spawn: vi.mocked(spawn), spawnSync: vi.mocked(spawnSync) };
const PID = 12_345;
const TOOL_TIMEOUT_MS = 5000;
const SYSTEM_ROOT = String.raw`C:\Windows`;
const TASKKILL = String.raw`C:\Windows\System32\taskkill.exe`;
const runningChild = (exited: boolean): ChildProcess =>
  // eslint-disable-next-line unicorn/no-null -- mirrors Node's running-child state
  ({ exitCode: exited ? 0 : null, pid: PID, signalCode: null }) as ChildProcess;

const emulateKiller = (outcome: string): void => {
  mocked.spawn.mockImplementationOnce(() => {
    // eslint-disable-next-line unicorn/prefer-event-target -- ChildProcess uses Node's EventEmitter contract
    const killer = Object.assign(new EventEmitter(), { killed: outcome === 'timeout' });
    queueMicrotask(() => {
      if (outcome === 'error') {
        killer.emit('error', new Error('taskkill unavailable'));
      } else {
        killer.emit('close', outcome === 'failure' ? 1 : 0);
      }
    });
    return killer as ChildProcess;
  });
};

const terminateWithRoot = async (root: string): Promise<string | undefined> => {
  vi.stubEnv('SystemRoot', root);
  try {
    return await terminateProcessTree(runningChild(false), 'win32');
  } finally {
    vi.unstubAllEnvs();
  }
};

const expectKillerOptions = (): void => {
  expect(mocked.spawn).toHaveBeenCalledWith(TASKKILL, ['/pid', String(PID), '/T', '/F'], {
    killSignal: 'SIGKILL',
    shell: false,
    stdio: 'ignore',
    timeout: TOOL_TIMEOUT_MS,
  });
};

describe('windows termination uncertainty', () => {
  it('never targets an exited child PID and reports unconfirmed descendants', async () => {
    expect.hasAssertions();
    mocked.spawn.mockClear();
    await expect(terminateProcessTree(runningChild(true), 'win32')).resolves.toContain(
      'direct child already exited',
    );
    expect(mocked.spawn).not.toHaveBeenCalled();
  });

  it.each(['failure', 'timeout', 'error'])(
    'reports taskkill %s without pretending descendants stopped',
    async (outcome) => {
      expect.hasAssertions();
      mocked.spawn.mockClear();
      emulateKiller(outcome);
      await expect(terminateWithRoot(SYSTEM_ROOT)).resolves.toContain('could not confirm');
      expectKillerOptions();
    },
  );

  it.each(['relative', String.raw`\Windows`])(
    'refuses non-qualified SystemRoot %s without cwd or PATH fallback',
    async (root) => {
      expect.hasAssertions();
      mocked.spawn.mockClear();
      await expect(terminateWithRoot(root)).resolves.toContain(
        'absolute SystemRoot is unavailable',
      );
      expect(mocked.spawn).not.toHaveBeenCalled();
    },
  );

  it('accepts taskkill success only after the utility exits successfully', async () => {
    expect.hasAssertions();
    emulateKiller('success');
    await expect(terminateWithRoot(SYSTEM_ROOT)).resolves.toBeUndefined();
  });
});
