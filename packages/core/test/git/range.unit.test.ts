import { describe, expect, it } from 'vitest';
import { rangeNameStatus, showFileAtTag } from '../../src/git/range.ts';
import { FakeRunner } from '../../src/proc/fake-runner.ts';

// Scripted-runner unit suite for git/range.ts (real-git behaviour lives in `range.test.ts`,
// mirroring the `repo.test.ts`/`repo.unit.test.ts` split): pins `showFileAtTag`'s
// absence-versus-failure contract — only git's known "not there" stderr shapes may map to
// `undefined`; any other non-zero exit must throw instead of masquerading as an absent file —
// and `rangeNameStatus`'s quotePath-disabling argument order.

const DIR = '/tmp/checkout';
const GIT_FAILURE_EXIT_CODE = 128;
const TARGET = { path: 'CHANGELOG.md', tag: 'v1.0.0' };
const WIDE_LIMIT = 200;

describe('showFileAtTag: absence stderr maps to undefined', () => {
  it.each([
    "fatal: path 'CHANGELOG.md' does not exist in 'v1.0.0'\n",
    "fatal: path 'CHANGELOG.md' exists on disk, but not in 'v1.0.0'\n",
    "fatal: invalid object name 'v1.0.0'.\n",
    "fatal: bad revision 'v1.0.0:CHANGELOG.md'\n",
    'fatal: Not a valid object name v1.0.0:CHANGELOG.md\n',
  ])('returns undefined for %j', async (stderr) => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git show', { exitCode: GIT_FAILURE_EXIT_CODE, stderr }, { cwd: DIR });

    await expect(showFileAtTag(runner, DIR, TARGET)).resolves.toBeUndefined();
  });
});

describe('showFileAtTag: any other failure throws', () => {
  it('surfaces a non-absence git failure as a validationError instead of undefined', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git show', {
      exitCode: GIT_FAILURE_EXIT_CODE,
      stderr: 'fatal: unable to read tree (deadbeef)\n',
    });

    await expect(showFileAtTag(runner, DIR, TARGET)).rejects.toThrow(
      /git show failed: fatal: unable to read tree/u,
    );
  });
});

describe('rangeNameStatus: quotePath handling', () => {
  it('prepends -c core.quotePath=false before the diff subcommand', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git -c core.quotePath=false diff --name-status', {
      stdout: 'A\tcafé.txt\n',
    });

    const result = await rangeNameStatus(runner, DIR, {
      limit: WIDE_LIMIT,
      newTag: 'v2.0.0',
      oldTag: 'v1.0.0',
    });

    expect(result.paths).toStrictEqual([{ path: 'café.txt', status: 'A' }]);
  });
});
