import { descendantsOf, parseProcessTable, signalTree } from '../../src/proc/spawn-tree.ts';
import { describe, expect, it } from 'vitest';
import type { Exec } from '../../src/proc/spawn-tree.ts';
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

describe('signalling a tree', () => {
  it('hands the whole tree to taskkill on Windows', async () => {
    expect.hasAssertions();
    const { calls, exec } = recordingExec({ exitCode: 0, stderr: '', stdout: '' });
    await signalTree({ exec, pid: ROOT, platform: 'win32', seen: new Set() }, 'SIGTERM');
    expect(calls).toStrictEqual([['taskkill', '/PID', String(ROOT), '/T', '/F']]);
  });

  it('records nothing it could not see when ps fails', async () => {
    expect.hasAssertions();
    const { calls, exec } = recordingExec({ exitCode: FAILED, stderr: 'no ps', stdout: TABLE });
    const seen = new Set<number>();
    await signalTree({ exec, pid: IMPOSSIBLE_PID, platform: 'linux', seen }, 'SIGTERM');
    expect(calls).toHaveLength(1);
    expect([...seen]).toStrictEqual([]);
  });
});
