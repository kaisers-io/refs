import type { Exec, TreeTarget } from '../../src/proc/spawn-tree.ts';
import { descendantsOf, parseProcessTable, signalTree } from '../../src/proc/spawn-tree.ts';
import { describe, expect, it } from 'vitest';
import type { RunResult } from '../../src/proc/runner.ts';

// The pure half of the process-tree walk a timeout uses to end a command (spawn-tree.ts). The
// real-process half is in runner-timeout-tree.test.ts.

const ROOT = 100;
const CHILD = 101;
const GRANDCHILD = 102;
const SIBLING = 103;
const UNRELATED = 200;
const FAILED = 1;
// A pid that cannot exist, so a direct signal to it is a harmless ESRCH.
const IMPOSSIBLE_PID = 1_073_741_824;

const TABLE = [
  `  ${String(ROOT)}     1`,
  `  ${String(CHILD)}   ${String(ROOT)}`,
  `  ${String(GRANDCHILD)}   ${String(CHILD)}`,
  `  ${String(SIBLING)}   ${String(ROOT)}`,
  `  ${String(UNRELATED)}     1`,
  'garbage line',
  '',
].join('\n');

const recordingExec = (result: RunResult): { calls: string[][]; exec: Exec } => {
  const calls: string[][] = [];
  const exec: Exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    return Promise.resolve(result);
  };
  return { calls, exec };
};

describe('walking the process table', () => {
  it('finds every descendant of the root, and nothing else', () => {
    expect.hasAssertions();
    const found = descendantsOf(parseProcessTable(TABLE), ROOT);
    expect(found.toSorted()).toStrictEqual([CHILD, GRANDCHILD, SIBLING]);
  });

  it('finds none for a pid with no children', () => {
    expect.hasAssertions();
    expect(descendantsOf(parseProcessTable(TABLE), UNRELATED)).toStrictEqual([]);
  });

  it('terminates on a table that claims a cycle', () => {
    expect.hasAssertions();
    const cyclic = parseProcessTable(
      `${String(CHILD)} ${String(ROOT)}\n${String(ROOT)} ${String(CHILD)}`,
    );
    expect(descendantsOf(cyclic, ROOT)).toStrictEqual([CHILD]);
  });
});

const OK: RunResult = { exitCode: 0, stderr: '', stdout: '' };

/** A tree rooted at an impossible pid, alive unless `overrides` says otherwise. */
const targetFor = (exec: Exec, overrides: Partial<TreeTarget>): TreeTarget => ({
  exec,
  pid: IMPOSSIBLE_PID,
  platform: 'linux',
  rootAlive: () => true,
  seen: new Set<number>(),
  systemRoot: undefined,
  ...overrides,
});

describe('signalling a tree', () => {
  it('hands the whole tree to the taskkill under SystemRoot on Windows', async () => {
    expect.hasAssertions();
    const { calls, exec } = recordingExec(OK);
    const target = targetFor(exec, { pid: ROOT, platform: 'win32', systemRoot: 'C:\\Windows' });
    await signalTree(target, 'SIGTERM');
    expect(calls).toStrictEqual([
      [String.raw`C:\Windows\System32\taskkill.exe`, '/PID', String(ROOT), '/T', '/F'],
    ]);
  });

  it.each([undefined, 'Windows', '.\\'])(
    'never runs a taskkill found by name, with SystemRoot %s',
    async (systemRoot) => {
      expect.hasAssertions();
      const { calls, exec } = recordingExec(OK);
      await signalTree(targetFor(exec, { platform: 'win32', systemRoot }), 'SIGTERM');
      expect(calls).toStrictEqual([]);
    },
  );

  it.each(['win32', 'linux'] as const)(
    'aims nothing at a root that has exited, whose pid may be reused (%s)',
    async (platform) => {
      expect.hasAssertions();
      const { calls, exec } = recordingExec({ ...OK, stdout: TABLE });
      const target = targetFor(exec, {
        platform,
        rootAlive: () => false,
        systemRoot: 'C:\\Windows',
      });
      await signalTree(target, 'SIGTERM');
      expect(calls).toStrictEqual([]);
    },
  );

  it('records nothing it could not see when ps fails', async () => {
    expect.hasAssertions();
    const { calls, exec } = recordingExec({ exitCode: FAILED, stderr: 'no ps', stdout: TABLE });
    const target = targetFor(exec, {});
    await signalTree(target, 'SIGTERM');
    expect(calls).toHaveLength(1);
    expect([...target.seen]).toStrictEqual([]);
  });
});
