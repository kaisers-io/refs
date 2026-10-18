import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { killWindowsTree } from '../../src/proc/spawn-timeout.ts';

// The Windows deadline path, driven with a stand-in child so it runs on every platform. taskkill
// finds descendants through their live root and names the root by PID: once the root has exited,
// `/T` reaches nothing it started, and the PID may already belong to an unrelated process.

const ENV = { SystemRoot: String.raw`C:\Windows` };
const ROOT_PID = 4242;

type StandIn = ChildProcess & { stdout: PassThrough; stderr: PassThrough };
type Exit = 'running' | 'exited' | 'signalled';
type Start = (...args: unknown[]) => { on: () => void };

// ChildProcess reports "not yet" as null, which is what the code under test reads.
// eslint-disable-next-line unicorn/no-null -- the ChildProcess shape under test uses null
const NOT_YET = null;

const standIn = (exit: Exit): StandIn =>
  ({
    exitCode: exit === 'exited' ? 1 : NOT_YET,
    kill: vi.fn<() => boolean>(() => true),
    pid: ROOT_PID,
    signalCode: exit === 'signalled' ? 'SIGTERM' : NOT_YET,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  }) as unknown as StandIn;

const starter = (): ReturnType<typeof vi.fn<Start>> => vi.fn<Start>(() => ({ on: () => {} }));

describe('the Windows deadline on a root that is still running', () => {
  it('stops its tree with taskkill by absolute path', () => {
    expect.hasAssertions();
    const start = starter();
    killWindowsTree(standIn('running'), start as never, ENV);
    expect(start).toHaveBeenCalledWith(
      String.raw`C:\Windows\System32\taskkill.exe`,
      ['/pid', String(ROOT_PID), '/T', '/F'],
      expect.objectContaining({ shell: false }),
    );
  });
});

describe('the Windows deadline on a root that already exited', () => {
  it('starts no taskkill for its PID', () => {
    expect.hasAssertions();
    const start = starter();
    killWindowsTree(standIn('exited'), start as never, ENV);
    killWindowsTree(standIn('signalled'), start as never, ENV);
    expect(start).not.toHaveBeenCalled();
  });

  it('closes its output pipes, so the run ends although a helper still holds them', () => {
    expect.hasAssertions();
    const child = standIn('exited');
    killWindowsTree(child, starter() as never, ENV);
    expect([child.stdout.destroyed, child.stderr.destroyed]).toStrictEqual([true, true]);
    expect(child.kill).not.toHaveBeenCalled();
  });
});
