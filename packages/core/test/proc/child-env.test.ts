import { REPO_LOCAL_GIT_ENV, sanitizedChildEnv } from '../../src/proc/child-env.ts';
import { describe, expect, it } from 'vitest';

// The rule is git's own `sanitize_repo_env()`: clear `local_repo_env`, keep the two variables that
// carry command-scope configuration. These cases pin both halves, and that the user's transport and
// authentication settings are not collateral.

const KEPT = {
  GIT_ASKPASS: '/usr/libexec/askpass',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_GLOBAL: '/tmp/gitconfig',
  GIT_CONFIG_KEY_0: 'url.https://mirror.example/.insteadOf',
  GIT_CONFIG_PARAMETERS: "'http.extraheader'='x'",
  GIT_CONFIG_VALUE_0: 'https://example.com/',
  GIT_SSH_COMMAND: 'ssh -i key',
  GIT_TERMINAL_PROMPT: '1',
  GIT_TRACE: '1',
  HOME: '/home/user',
  HTTPS_PROXY: 'http://proxy:3128',
  PATH: '/usr/bin',
};

// `git rev-parse --local-env-vars` on git 2.55, plus `GIT_INTERNAL_SUPER_PREFIX` (removed in 2.40),
// minus the two that `sanitize_repo_env()` deliberately keeps.
const GIT_LOCAL_ENV_MINUS_CONFIG = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG',
  'GIT_DIR',
  'GIT_GRAFT_FILE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_INTERNAL_SUPER_PREFIX',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_REPLACE_REF_BASE',
  'GIT_SHALLOW_FILE',
  'GIT_WORK_TREE',
];

describe('the environment refs hands to a child process', () => {
  it('removes every repository-locating variable git itself clears', () => {
    expect.hasAssertions();
    const env = Object.fromEntries([...REPO_LOCAL_GIT_ENV].map((name) => [name, '/elsewhere']));

    expect(sanitizedChildEnv({ ...env, ...KEPT }, 'linux')).toStrictEqual(KEPT);
  });

  it('keeps command-scope configuration, authentication and transport settings', () => {
    expect.hasAssertions();

    expect(sanitizedChildEnv(KEPT, 'linux')).toStrictEqual(KEPT);
  });

  it('matches names case-insensitively on Windows only', () => {
    expect.hasAssertions();
    const env = { Git_Dir: 'C:\\other\\.git', PATH: 'C:\\', git_index_file: 'C:\\other\\index' };

    expect(sanitizedChildEnv(env, 'win32')).toStrictEqual({ PATH: 'C:\\' });
    // POSIX names are case-sensitive: git reads `GIT_DIR`, never `Git_Dir`.
    expect(sanitizedChildEnv(env, 'linux')).toStrictEqual(env);
  });

  it('returns a copy and leaves the environment it was given untouched', () => {
    expect.hasAssertions();
    const env = { GIT_DIR: '/elsewhere/.git', PATH: '/usr/bin' };

    const sanitized = sanitizedChildEnv(env, 'linux');

    expect(sanitized).not.toBe(env);
    expect(env).toStrictEqual({ GIT_DIR: '/elsewhere/.git', PATH: '/usr/bin' });
  });

  it('lists exactly git 2.55 repository-local variables, plus the pre-2.40 one', () => {
    expect.hasAssertions();

    expect([...REPO_LOCAL_GIT_ENV].toSorted()).toStrictEqual(GIT_LOCAL_ENV_MINUS_CONFIG);
  });
});
