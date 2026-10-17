import { describe, expect, it } from 'vitest';
import { gitPolicyEnvironment } from '../../src/proc/git-policy-env.ts';

describe('git policy child environment', () => {
  it('limits transport helpers and replaces inherited policy-value spoofing', () => {
    expect.hasAssertions();
    const env = {
      GIT_DIR: '/caller',
      GIT_SSH_COMMAND: 'trusted ssh',
      REFS_GIT_POLICY_FALSE: 'true',
    };
    const result = gitPolicyEnvironment(env, 'linux');
    expect(result['GIT_ALLOW_PROTOCOL']).toBe('https:http:ssh:git:file');
    expect(result['REFS_GIT_POLICY_FALSE']).toBe('false');
    expect(result['GIT_DIR']).toBeUndefined();
    expect(result['GIT_SSH_COMMAND']).toBe('trusted ssh');
    expect(env['REFS_GIT_POLICY_FALSE']).toBe('true');
  });

  it('never expands an existing caller protocol restriction', () => {
    expect.hasAssertions();
    expect(
      gitPolicyEnvironment({ GIT_ALLOW_PROTOCOL: 'https:ext:ssh' })['GIT_ALLOW_PROTOCOL'],
    ).toBe('https:ssh');
    expect(gitPolicyEnvironment({ GIT_ALLOW_PROTOCOL: '' })['GIT_ALLOW_PROTOCOL']).toBe('');
  });

  it('removes mixed-case duplicate policy names on Windows', () => {
    expect.hasAssertions();
    const result = gitPolicyEnvironment(
      { Git_Allow_Protocol: 'https', Refs_Git_Policy_False: 'true' },
      'win32',
    );
    expect(result['GIT_ALLOW_PROTOCOL']).toBe('https');
    expect(result['REFS_GIT_POLICY_FALSE']).toBe('false');
    expect(result['Git_Allow_Protocol']).toBeUndefined();
    expect(result['Refs_Git_Policy_False']).toBeUndefined();
  });
});
