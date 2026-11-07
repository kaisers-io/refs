import { describe, expect, it } from 'vitest';
import { FakeRunner } from '../../src/proc/fake-runner.ts';
import { cloneRepo } from '../../src/git/repo.ts';
import { redactUrlsInText } from '../../src/git-url-redact.ts';

// A failing git command's message carries the child's own output, which is remote-controlled text
// on its way into the `--json` envelope an agent parses. `spawn-collector.ts` caps a stream at
// 64 MiB, which is a safety valve against an OOM rather than a bound for a message. These pin the
// two properties the seam now guarantees: a bound, and url userinfo stripped on the way through.

const CLONE_OPTS = {
  cloneUrl: 'https://example.com/o/r.git',
  dest: '/refs-home/sources/example.com/o/r',
  hooksDir: '/refs-home/hooks',
  mode: 'full',
} as const;

const MAX_DETAIL_LENGTH = 2000;
const OVERLONG = 5000;
const FAILURE = 1;

const failingClone = async (stderr: string): Promise<string> => {
  const runner = new FakeRunner();
  runner.expect('git clone', { exitCode: FAILURE, stderr });
  const failed: unknown = await cloneRepo(runner, CLONE_OPTS).catch((error: unknown) => error);
  expect(failed).toBeInstanceOf(Error);
  return (failed as Error).message;
};

describe('stripping url userinfo from a larger text', () => {
  it('strips userinfo from every url in a larger text, leaving the rest readable', () => {
    expect.hasAssertions();
    const text = "fatal: unable to access 'https://usr:sekrit@example.com/o/r.git/': denied";
    const redacted = redactUrlsInText(text);
    expect(redacted).not.toContain('sekrit');
    expect(redacted).toContain('<redacted>@example.com');
    expect(redacted).toContain('denied');
  });

  it('leaves text without a url untouched', () => {
    expect.hasAssertions();
    expect(redactUrlsInText('fatal: not a git repository')).toBe('fatal: not a git repository');
  });
});

describe('a failing git command', () => {
  it('does not carry url userinfo from the child into the thrown message', async () => {
    expect.hasAssertions();
    const message = await failingClone("fatal: unable to access 'ssh://tok3n@h/o/r.git/': nope");
    expect(message).not.toContain('tok3n');
    expect(message).toContain('<redacted>@h');
  });

  it('bounds an overlong child message rather than passing it through whole', async () => {
    expect.hasAssertions();
    const message = await failingClone('x'.repeat(OVERLONG));
    expect(message.length).toBeLessThan(OVERLONG);
    expect(message).toContain('(truncated)');
  });

  it('still reports a short failure in full', async () => {
    expect.hasAssertions();
    const message = await failingClone('fatal: repository not found');
    expect(message).toContain('fatal: repository not found');
    expect(message).not.toContain('truncated');
    expect(message.length).toBeLessThan(MAX_DETAIL_LENGTH);
  });
});
