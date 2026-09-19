import type { RunResult, Runner } from '../../src/proc/runner.ts';
import { describe, expect, it } from 'vitest';
import { packagesBefore } from '../../src/git/arrivals.ts';

// The conservative paths: what happens when git cannot answer. Every one of these must resolve to
// `undefined` — "nothing can be said" — rather than to an empty before-picture, which a caller
// would read as "the repository had no packages" and turn into a false arrival.
//
// Driven by a fake runner rather than real git, because the thing under test is the reaction to
// git's output, not git. `declarations.test.ts` covers the same ground end to end.

const OK = 0;
const FAILED = 128;
const OVER_THE_CAP = 201;
const DIR = '/repo';
const FROM = 'aaaa';
const TO = 'bbbb';

const ok = (stdout: string): RunResult => ({ exitCode: OK, stderr: '', stdout });
const failed = (): RunResult => ({ exitCode: FAILED, stderr: 'fatal: bad object', stdout: '' });

/** A runner answering each git subcommand from `replies`, defaulting to a clean empty answer. */
const fakeRunner = (replies: Partial<Record<string, () => RunResult>>): Runner => ({
  run: (_cmd, args) => {
    const reply = replies[String(args[0])];
    return Promise.resolve(reply === undefined ? ok('') : reply());
  },
});

const before = (runner: Runner): ReturnType<typeof packagesBefore> =>
  packagesBefore(runner, { dir: DIR, from: FROM, to: TO });

describe('a range git cannot describe', () => {
  it('says nothing when the diff itself fails', async () => {
    expect.hasAssertions();

    await expect(before(fakeRunner({ diff: failed }))).resolves.toBeUndefined();
  });

  it('says nothing when the changed manifests cannot be listed at the old revision', async () => {
    expect.hasAssertions();

    // The diff answers, so there is something to read; `ls-tree` is what fails, leaving it unknown
    // which of those paths existed before.
    const runner = fakeRunner({
      diff: () => ok('packages/a/package.json\0'),
      'ls-tree': failed,
    });

    await expect(before(runner)).resolves.toBeUndefined();
  });

  it('says nothing when a manifest that DID exist cannot be read', async () => {
    expect.hasAssertions();

    // A name that cannot be read is a name that cannot be ruled out as pre-existing; skipping it
    // would announce a package that was there all along.
    const runner = fakeRunner({
      diff: () => ok('packages/a/package.json\0'),
      'ls-tree': () => ok('packages/a/package.json\0'),
      show: failed,
    });

    await expect(before(runner)).resolves.toBeUndefined();
  });

  it('says nothing when a manifest that DID exist does not parse', async () => {
    expect.hasAssertions();

    const runner = fakeRunner({
      diff: () => ok('packages/a/package.json\0'),
      'ls-tree': () => ok('packages/a/package.json\0'),
      show: () => ok('{ not json'),
    });

    await expect(before(runner)).resolves.toBeUndefined();
  });
});

describe('a range too large to read', () => {
  it('says nothing rather than reading every changed manifest', async () => {
    expect.hasAssertions();

    // A repository-wide rewrite, or a long-lived branch merged in. Reading every old blob would
    // cost more than the finding is worth, and reporting nothing is the safe direction.
    const many = Array.from(
      { length: OVER_THE_CAP },
      (_unused, index) => `packages/p${index}/package.json`,
    );
    const runner = fakeRunner({ diff: () => ok(`${many.join('\0')}\0`) });

    await expect(before(runner)).resolves.toBeUndefined();
  });
});

// Truncation is NOT the quiet failure it looks like. A cut stream keeps the FIRST bytes, so it
// reads as a complete, smaller answer — and for history, a smaller answer means MORE arrivals, not
// fewer: the evidence that a name already existed is what goes missing.
//
// Concretely, for the diff: a range that adds `a/package.json` with an existing name and deletes
// `z/package.json`, which is where that name used to live. Put enough changed paths between them
// to reach the cap and the deletion is simply not in the output. The pathspec also selects files
// like `mypackage.json`, which the basename check then discards, so the 200-manifest guard does
// not bound how much output has to arrive before the paths that matter.
const PATH_A = 'a/package.json';
const PATH_Z = 'z/package.json';
const EXISTING_NAME = 'existing-name';

const truncated = (stdout: string): RunResult => ({
  exitCode: OK,
  stderr: '',
  stdout,
  stdoutTruncated: true,
});

describe('a range git could only answer in part', () => {
  it('says nothing when the diff output was cut at the stream cap', async () => {
    expect.hasAssertions();
    // Exit 0 and a perfectly well-formed prefix: indistinguishable from a complete answer without
    // the flag. The deletion that carried the name is past the cut.
    const runner = fakeRunner({ diff: () => truncated('a/package.json\0') });

    await expect(before(runner)).resolves.toBeUndefined();
  });

  it('says nothing when the old-revision listing was cut at the stream cap', async () => {
    expect.hasAssertions();
    // `ls-tree` decides which changed paths existed BEFORE. A cut listing reads as "this one was
    // not there", which is a statement about membership rather than a failure to look — and the
    // path it loses is where a deleted package's name lives.
    const runner = fakeRunner({
      diff: () => ok(`${PATH_A}\0${PATH_Z}\0`),
      'ls-tree': () => truncated(`${PATH_A}\0`),
      show: () => ok(JSON.stringify({ name: EXISTING_NAME })),
    });

    await expect(before(runner)).resolves.toBeUndefined();
  });

  it('answers normally when that same listing arrived whole', async () => {
    expect.hasAssertions();
    // The control: identical scripting, complete output. Without it the case above holds for a
    // fixture that answers `undefined` for some unrelated reason.
    const runner = fakeRunner({
      diff: () => ok(`${PATH_A}\0${PATH_Z}\0`),
      'ls-tree': () => ok(`${PATH_A}\0${PATH_Z}\0`),
      show: () => ok(JSON.stringify({ name: EXISTING_NAME })),
    });

    await expect(before(runner)).resolves.toStrictEqual({
      changedDirs: ['a', 'z'],
      namesBefore: [EXISTING_NAME, EXISTING_NAME],
    });
  });
});
