import { GIT_POLICY_ARGS, withGitPolicy } from '../../src/proc/git-policy.ts';
import { describe, expect, it } from 'vitest';

// The spellings are the point (see git-policy.ts): an empty fsmonitor rather than `false`, which
// git 2.35.1 and older run as a program, and an event-level hook switch per event refs can fire.

describe('the options refs puts in front of a git command', () => {
  it('switches fsmonitor off with the empty value and configured hooks off per event', () => {
    expect.hasAssertions();
    expect(GIT_POLICY_ARGS).toStrictEqual([
      '-c',
      'core.fsmonitor=',
      '-c',
      'hook.post-checkout.enabled=false',
      '-c',
      'hook.post-index-change.enabled=false',
      '-c',
      'hook.pre-auto-gc.enabled=false',
      '-c',
      'hook.reference-transaction.enabled=false',
    ]);
  });

  it('puts them before the subcommand, where git reads them as top-level options', () => {
    expect.hasAssertions();
    expect(withGitPolicy('git', ['status', '--porcelain'])).toStrictEqual([
      ...GIT_POLICY_ARGS,
      'status',
      '--porcelain',
    ]);
  });

  it('leaves any other command alone', () => {
    expect.hasAssertions();
    const args = ['-o', 'BatchMode=yes', '-T', 'git@example.com'];
    expect(withGitPolicy('ssh', args)).toBe(args);
  });
});
