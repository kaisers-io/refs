import { describe, expect, it } from 'vitest';
import { gitSpec, runOrThrow } from '../../src/git/run-or-throw.ts';
import { FakeRunner } from '../../src/proc/fake-runner.ts';

// A git step that fails because of refs' own settings says so, and says what to change: git's
// words for a disabled prompt or a killed command do not mention refs at all.

const FAILURE = 1;
const TIMEOUT_EXIT_CODE = 124;
const PROMPT_STDERR =
  "fatal: could not read Username for 'https://example.com': terminal prompts disabled";

const failureOf = async (result: Parameters<FakeRunner['expect']>[1]): Promise<string> => {
  const runner = new FakeRunner();
  runner.expect('git fetch', result);
  const failed: unknown = await runOrThrow(runner, gitSpec('git fetch', ['fetch'])).catch(
    (error: unknown) => error,
  );
  expect(failed).toBeInstanceOf(Error);
  return (failed as Error).message;
};

describe('failure hints', () => {
  it('names credential helpers and the opt-out when git was not allowed to prompt', async () => {
    expect.hasAssertions();
    const message = await failureOf({ exitCode: FAILURE, stderr: PROMPT_STDERR });
    expect(message).toContain('terminal prompts disabled');
    expect(message).toContain('credential helper');
    expect(message).toContain('GIT_TERMINAL_PROMPT=1');
  });

  it('names REFS_GIT_TIMEOUT when the command was ended by the timeout', async () => {
    expect.hasAssertions();
    const message = await failureOf({
      exitCode: TIMEOUT_EXIT_CODE,
      stderr: 'refs: command timed out after 1000ms',
      timedOut: true,
    });
    expect(message).toContain('timed out after 1000ms');
    expect(message).toContain('REFS_GIT_TIMEOUT=0');
  });

  it('adds no hint to a failure of git’s own, even one that exits 124', async () => {
    expect.hasAssertions();
    const message = await failureOf({ exitCode: TIMEOUT_EXIT_CODE, stderr: 'fatal: no' });
    expect(message).toBe('git fetch failed: fatal: no');
  });
});
