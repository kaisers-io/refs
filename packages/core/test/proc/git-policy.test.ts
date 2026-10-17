import { GIT_POLICY_ARGS, HOOK_EVENTS, withGitPolicy } from '../../src/proc/git-policy.ts';
import { describe, expect, it } from 'vitest';

// The spellings are the point (see git-policy.ts): an empty fsmonitor rather than `false`, which
// git 2.35.1 and older run as a program, submodule recursion off, and an event-level hook switch
// for every event git documents rather than the few refs is known to fire today.

// githooks(5) as of git 2.56, the newest release this list was checked against.
const DOCUMENTED_EVENTS = 28;
// Three `-c` pairs: fsmonitor and the two submodule switches.
const LEADING_ARGS = 6;

describe('the options refs puts in front of a git command', () => {
  it('switches fsmonitor and submodule recursion off', () => {
    expect.hasAssertions();
    expect(GIT_POLICY_ARGS.slice(0, LEADING_ARGS)).toStrictEqual([
      '-c',
      'core.fsmonitor=',
      '-c',
      'submodule.recurse=false',
      '-c',
      'fetch.recurseSubmodules=false',
    ]);
  });

  it('switches configured hooks off for every documented event', () => {
    expect.hasAssertions();
    expect(HOOK_EVENTS).toHaveLength(DOCUMENTED_EVENTS);
    for (const event of ['post-checkout', 'post-merge', 'pre-auto-gc', 'reference-transaction']) {
      expect(GIT_POLICY_ARGS).toContain(`hook.${event}.enabled=false`);
    }
    const switches = GIT_POLICY_ARGS.filter((arg) => arg.startsWith('hook.'));
    expect(switches).toStrictEqual(HOOK_EVENTS.map((event) => `hook.${event}.enabled=false`));
  });

  it('puts them before the subcommand, where git reads them as top-level options', () => {
    expect.hasAssertions();
    expect(withGitPolicy('git', ['status', '--porcelain'])).toStrictEqual([
      ...GIT_POLICY_ARGS,
      'status',
      '--porcelain',
    ]);
  });

  it('pins the hooks path first when it knows refs hooks directory', () => {
    expect.hasAssertions();
    expect(withGitPolicy('git', ['fetch'], '/refs/hooks')).toStrictEqual([
      '-c',
      'core.hooksPath=/refs/hooks',
      ...GIT_POLICY_ARGS,
      'fetch',
    ]);
  });

  it('leaves any other command alone', () => {
    expect.hasAssertions();
    const args = ['-o', 'BatchMode=yes', '-T', 'git@example.com'];
    expect(withGitPolicy('ssh', args, '/refs/hooks')).toBe(args);
  });
});
