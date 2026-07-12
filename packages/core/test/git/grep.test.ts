import { describe, expect, it } from 'vitest';
import { FakeRunner } from '../../src/proc/fake-runner.ts';
import { grepCheckout } from '../../src/git/grep.ts';

// Scripted-runner unit suite for `grepCheckout` — real-git behaviour (tracked files, pathspec
// Excludes, package scoping) is covered end-to-end by the CLI's `search.test.ts`; this suite pins
// The exit-code contract (0 = matches, 1 = clean no-match, anything else = validationError) and
// The parsing/bounding rules (limit, truncation flag, snippet trim + cap) against scripted output.

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

describe('grepCheckout: match parsing', () => {
  it('parses `path:line:content` lines, trimming and capping each snippet', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    const longLine = 'x'.repeat(LONG_LINE_LENGTH);
    runner.expect(
      'git grep',
      { stdout: `src/a.ts:3:   const alpha = true;\nsrc/b.ts:7:${longLine}\n` },
      { cwd: DIR },
    );

    const result = await grepCheckout(runner, optsFor(BIG_LIMIT));

    expect(result.truncated).toBe(false);
    expect(result.matches).toStrictEqual([
      { line: 3, path: 'src/a.ts', snippet: 'const alpha = true;' },
      { line: 7, path: 'src/b.ts', snippet: 'x'.repeat(SNIPPET_CAP) },
    ]);
  });

  it('passes the pattern via -e and appends pathspecs after the -- separator', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git grep', { exitCode: 1 });

    await grepCheckout(runner, optsFor(BIG_LIMIT, ['packages/pkg', ':(exclude)dist']));

    const [firstCall] = runner.calls;
    expect(firstCall?.args).toStrictEqual([
      'grep',
      '-n',
      '-I',
      '--extended-regexp',
      '-e',
      'alpha',
      '--',
      'packages/pkg',
      ':(exclude)dist',
    ]);
  });
});

describe('grepCheckout: limit and truncation', () => {
  it('returns at most `limit` matches and flags truncation when git produced more lines', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git grep', {
      stdout: 'src/a.ts:1:alpha one\nsrc/a.ts:2:alpha two\nsrc/a.ts:3:alpha three\n',
    });

    const result = await grepCheckout(runner, optsFor(SMALL_LIMIT));

    expect(result.truncated).toBe(true);
    expect(result.matches).toStrictEqual([
      { line: 1, path: 'src/a.ts', snippet: 'alpha one' },
      { line: 2, path: 'src/a.ts', snippet: 'alpha two' },
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
