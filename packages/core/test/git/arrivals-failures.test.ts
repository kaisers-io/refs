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
