import type { RunResult, Runner } from '../../src/proc/runner.ts';
import { describe, expect, it } from 'vitest';
import { membershipNarrowed } from '../../src/git/declarations.ts';

// A truncated read of a workspace declaration is the case that looks quiet and is not.
//
// The cut keeps the FIRST bytes, and a prefix of a YAML list is a valid YAML list — a smaller one.
// So a `pnpm-workspace.yaml` cut mid-file does not fail to parse; it parses as a declaration that
// includes fewer directories than it really does. Compared against the real declaration on the
// other side of the range, that reads as a WIDENING, which is exactly the answer that says the
// before-picture can be trusted. A package that was always there is then announced as an arrival.
//
// JSON is the fortunate case — a cut manifest fails `JSON.parse` and reaches the give-up path on
// its own — which is why this is asked of the YAML reader.

const OK = 0;
const DIR = '/repo';
const OLD = 'aaaa';
const NEW = 'bbbb';

// Two directories, with the second past the cut. Both halves are valid YAML.
const FULL_DECLARATION = 'packages:\n  - packages/a\n  - packages/b\n';
const CUT_DECLARATION = 'packages:\n  - packages/a\n';
// The declaration at the far end of the range: `b` is gone, so membership really did narrow.
const NARROWED_DECLARATION = 'packages:\n  - packages/a\n  - packages/c\n';

const reply = (stdout: string, truncated = false): RunResult => ({
  exitCode: OK,
  stderr: '',
  stdout,
  ...(truncated ? { stdoutTruncated: true as const } : {}),
});

const LAST = -1;

/** Answers `ls-tree` with "the file is there" and `show` with whichever side is being read. */
const fakeRunner = (at: { new: RunResult; old: RunResult }): Runner => ({
  run: (_cmd, args) => {
    const path = String(args.at(LAST));
    if (args[0] === 'ls-tree') {
      return Promise.resolve(reply(path));
    }
    const isOldSide = String(args[1]).startsWith(OLD);
    return Promise.resolve(isOldSide ? at.old : at.new);
  },
});

const narrowed = (at: { new: RunResult; old: RunResult }): Promise<boolean> =>
  membershipNarrowed(fakeRunner(at), { dir: DIR, from: OLD, to: NEW, touched: true });

describe('a workspace declaration read only in part', () => {
  it('reports the narrowing when the old declaration was read whole', async () => {
    expect.hasAssertions();

    await expect(
      narrowed({ new: reply(NARROWED_DECLARATION), old: reply(FULL_DECLARATION) }),
    ).resolves.toBe(true);
  });

  it('still reports it when the old declaration was cut at the stream cap', async () => {
    expect.hasAssertions();
    // Byte-for-byte the prefix above, and valid YAML: without the flag this is indistinguishable
    // from a repository that only ever declared `packages/a`, and the answer flips to `false`.
    await expect(
      narrowed({ new: reply(NARROWED_DECLARATION), old: reply(CUT_DECLARATION, true) }),
    ).resolves.toBe(true);
  });
});
