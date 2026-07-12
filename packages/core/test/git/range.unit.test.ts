import { describe, expect, it } from 'vitest';
import { rangeNameStatus, rangeShortstat, showFileAtTag } from '../../src/git/range.ts';
import { FakeRunner } from '../../src/proc/fake-runner.ts';

// Scripted-runner unit suite for git/range.ts (real-git behaviour lives in `range.test.ts`,
// mirroring the `repo.test.ts`/`repo.unit.test.ts` split): pins `showFileAtTag`'s
// absence-versus-failure contract — only git's PATH-absence stderr shapes may map to
// `undefined`; revision-level failures (invalid object name, bad revision) and any other
// non-zero exit must throw instead of masquerading as an absent file — plus
// `rangeNameStatus`'s NUL-field `-z` parsing and `parseShortstat`'s fail-closed rule
// (empty output = zeros, nonempty unrecognized output = validationError).

const DIR = '/tmp/checkout';
const GIT_FAILURE_EXIT_CODE = 128;
const TARGET = { path: 'CHANGELOG.md', tag: 'v1.0.0' };
const BOUNDS = { newTag: 'v2.0.0', oldTag: 'v1.0.0' };
const WIDE_LIMIT = 200;

describe('showFileAtTag: path-absence stderr maps to undefined', () => {
  it.each([
    "fatal: path 'CHANGELOG.md' does not exist in 'refs/tags/v1.0.0'\n",
    "fatal: path 'CHANGELOG.md' exists on disk, but not in 'refs/tags/v1.0.0'\n",
  ])('returns undefined for %j', async (stderr) => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git show', { exitCode: GIT_FAILURE_EXIT_CODE, stderr }, { cwd: DIR });

    await expect(showFileAtTag(runner, DIR, TARGET)).resolves.toBeUndefined();
  });
});

describe('showFileAtTag: revision-level and other failures throw', () => {
  it.each([
    "fatal: invalid object name 'refs/tags/v1.0.0'.\n",
    "fatal: bad revision 'refs/tags/v1.0.0:CHANGELOG.md'\n",
    'fatal: Not a valid object name refs/tags/v1.0.0:CHANGELOG.md\n',
    'fatal: unable to read tree (deadbeef)\n',
  ])('throws a validationError for %j', async (stderr) => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git show', { exitCode: GIT_FAILURE_EXIT_CODE, stderr });

    await expect(showFileAtTag(runner, DIR, TARGET)).rejects.toThrow(/git show failed: fatal:/u);
  });

  it('addresses the file via refs/tags/<tag>:<path> behind --end-of-options', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git show', { stdout: '# Changelog\n' });

    await expect(showFileAtTag(runner, DIR, TARGET)).resolves.toBe('# Changelog\n');

    const [firstCall] = runner.calls;
    expect(firstCall?.args).toStrictEqual([
      'show',
      '--end-of-options',
      'refs/tags/v1.0.0:CHANGELOG.md',
    ]);
  });
});

describe('rangeNameStatus: NUL-field parsing', () => {
  it('parses `-z` records, including rename pairs (new path, first status char)', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    const stream = ['A', 'café.txt', 'R100', 'src/old:name.ts', 'src/ta\tb.txt', ''].join('\0');
    runner.expect('git diff --name-status -z', { stdout: stream });

    const result = await rangeNameStatus(runner, DIR, { ...BOUNDS, limit: WIDE_LIMIT });

    expect(result.paths).toStrictEqual([
      { path: 'café.txt', status: 'A' },
      { path: 'src/ta\tb.txt', status: 'R' },
    ]);
  });

  it('spans refs/tags/<tag>s behind --end-of-options and scopes via :(literal)', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git diff --name-status -z', { stdout: '' });

    await rangeNameStatus(runner, DIR, { ...BOUNDS, limit: WIDE_LIMIT, pathScope: 'packages/p' });

    const [firstCall] = runner.calls;
    expect(firstCall?.args).toStrictEqual([
      'diff',
      '--name-status',
      '-z',
      '--end-of-options',
      'refs/tags/v1.0.0..refs/tags/v2.0.0',
      '--',
      ':(literal)packages/p',
    ]);
  });
});

describe('rangeShortstat: fail-closed parsing', () => {
  it('treats empty stdout as an all-zero diff', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git diff --shortstat', { stdout: '\n' });

    await expect(rangeShortstat(runner, DIR, BOUNDS)).resolves.toStrictEqual({
      deletions: 0,
      files_changed: 0,
      insertions: 0,
    });
  });

  it('rejects nonempty output that does not match the expected shape', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git diff --shortstat', { stdout: ' 3 Dateien geändert, 7 Einfügungen(+)\n' });

    await expect(rangeShortstat(runner, DIR, BOUNDS)).rejects.toThrow(
      /git diff --shortstat returned unrecognized output: 3 Dateien geändert/u,
    );
  });

  it('rejects a valid-looking shortstat embedded in surrounding garbage (anchored match)', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git diff --shortstat', {
      stdout: 'warning: partial output\n 2 files changed, 3 insertions(+)\ntrailing garbage\n',
    });

    await expect(rangeShortstat(runner, DIR, BOUNDS)).rejects.toThrow(
      /git diff --shortstat returned unrecognized output: warning: partial output/u,
    );
  });
});
