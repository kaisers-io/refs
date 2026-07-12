import { describe, expect, it } from 'vitest';
import { FakeRunner } from '../../src/proc/fake-runner.ts';
import { grepCheckout } from '../../src/git/grep.ts';

// Scripted-runner unit suite for `grepCheckout` — real-git behaviour (tracked files, pathspec
// Excludes, package scoping, delimiter-bearing file names) is covered end-to-end by the CLI's
// Search suites; this suite pins the exit-code contract (0 = matches, 1 = clean no-match,
// Anything else = validationError) and the parsing/bounding rules (NUL-field `-z` records,
// Limit, truncation flag, snippet trim + cap) against scripted output. One `git grep -z -n`
// Record is `<path> NUL <line> NUL <content> NEWLINE` (empirically verified layout), where the
// Path may itself contain newlines — records must be walked via NUL tokens, never split on `\n`.

const DIR = '/tmp/checkout';
const SMALL_LIMIT = 2;
const BIG_LIMIT = 50;
const SNIPPET_CAP = 200;
const LONG_LINE_LENGTH = 500;
const GREP_ERROR_EXIT_CODE = 2;

const optsFor = (limit: number, pathspecs: readonly string[] = []) => ({
  dir: DIR,
  limit,
  pathspecs,
  pattern: 'alpha',
});

const zRecord = (path: string, line: string, content: string): string =>
  `${path}\0${line}\0${content}\n`;

describe('grepCheckout: match parsing', () => {
  it('parses NUL-field records, trimming and capping each snippet', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    const longLine = 'x'.repeat(LONG_LINE_LENGTH);
    runner.expect(
      'git grep',
      {
        stdout:
          zRecord('src/a.ts', '3', '   const alpha = true;') + zRecord('src/b.ts', '7', longLine),
      },
      { cwd: DIR },
    );

    const result = await grepCheckout(runner, optsFor(BIG_LIMIT));

    expect(result.truncated).toBe(false);
    expect(result.matches).toStrictEqual([
      { line: 3, path: 'src/a.ts', snippet: 'const alpha = true;' },
      { line: 7, path: 'src/b.ts', snippet: 'x'.repeat(SNIPPET_CAP) },
    ]);
  });

  it('returns the full path for a file name containing a colon', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git grep', { stdout: zRecord('src/a:b.ts', '3', 'alpha here') }, { cwd: DIR });

    const result = await grepCheckout(runner, optsFor(BIG_LIMIT));

    expect(result.truncated).toBe(false);
    expect(result.matches).toStrictEqual([{ line: 3, path: 'src/a:b.ts', snippet: 'alpha here' }]);
  });
});

describe('grepCheckout: newline-bearing file names', () => {
  it('returns paths containing newlines verbatim (records are NUL-walked, never newline-split)', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    // A newline-bearing path sits inside its NUL token; a newline-splitting parser would report
    // The bogus tail (`b.ts`) as the path and silently drop the `src/a\n` prefix.
    runner.expect(
      'git grep',
      { stdout: zRecord('src/a\nb.ts', '3', 'alpha here') + zRecord('x\ny\nz.md', '1', 'alpha') },
      { cwd: DIR },
    );

    const result = await grepCheckout(runner, optsFor(BIG_LIMIT));

    expect(result.truncated).toBe(false);
    expect(result.matches).toStrictEqual([
      { line: 3, path: 'src/a\nb.ts', snippet: 'alpha here' },
      { line: 1, path: 'x\ny\nz.md', snippet: 'alpha' },
    ]);
  });
});

describe('grepCheckout: argument construction', () => {
  it('passes -z, the pattern via -e, and appends pathspecs after the -- separator', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git grep', { exitCode: 1 });

    await grepCheckout(runner, optsFor(BIG_LIMIT, [':(glob)src/**', ':(exclude)dist']));

    const [firstCall] = runner.calls;
    expect(firstCall?.args).toStrictEqual([
      'grep',
      '-z',
      '-n',
      '-I',
      '--extended-regexp',
      '-e',
      'alpha',
      '--',
      ':(glob)src/**',
      ':(exclude)dist',
    ]);
  });
});

describe('grepCheckout: limit and truncation', () => {
  it('returns at most `limit` matches and flags truncation when git produced more lines', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git grep', {
      stdout:
        zRecord('src/a.ts', '1', 'alpha one') +
        zRecord('src/a.ts', '2', 'alpha two') +
        zRecord('src/a.ts', '3', 'alpha three'),
    });

    const result = await grepCheckout(runner, optsFor(SMALL_LIMIT));

    expect(result.truncated).toBe(true);
    expect(result.matches).toStrictEqual([
      { line: 1, path: 'src/a.ts', snippet: 'alpha one' },
      { line: 2, path: 'src/a.ts', snippet: 'alpha two' },
    ]);
  });

  it('reports truncated and drops the partial last line when the runner byte-capped stdout', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    // The line count (three lines) sits UNDER the limit — only `stdoutTruncated` reveals that
    // Output is missing; the trailing `src/c.ts NUL 9 NUL al` fragment was cut mid-line by the
    // Byte cap and must never be parsed as a match.
    const partialFragment = ['src/c.ts', '9', 'al'].join('\0');
    runner.expect('git grep', {
      stdout:
        zRecord('src/a.ts', '1', 'alpha one') +
        zRecord('src/b.ts', '2', 'alpha two') +
        partialFragment,
      stdoutTruncated: true,
    });

    const result = await grepCheckout(runner, optsFor(BIG_LIMIT));

    expect(result.truncated).toBe(true);
    expect(result.matches).toStrictEqual([
      { line: 1, path: 'src/a.ts', snippet: 'alpha one' },
      { line: 2, path: 'src/b.ts', snippet: 'alpha two' },
    ]);
  });
});

describe('grepCheckout: exit codes', () => {
  it('treats exit 1 (no matches) as a clean empty result, not an error', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git grep', { exitCode: 1 });

    const result = await grepCheckout(runner, optsFor(BIG_LIMIT));

    expect(result).toStrictEqual({ matches: [], truncated: false });
  });

  it('surfaces any other non-zero exit as a validationError carrying stderr', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git grep', {
      exitCode: GREP_ERROR_EXIT_CODE,
      stderr: 'fatal: unrecognized argument\n',
    });

    await expect(grepCheckout(runner, optsFor(BIG_LIMIT))).rejects.toThrow(
      /git grep failed: fatal: unrecognized argument/u,
    );
  });
});
