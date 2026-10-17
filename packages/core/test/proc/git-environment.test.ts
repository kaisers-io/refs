import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { gitEnvironment } from '../../src/proc/git-environment.ts';
import { promisify } from 'node:util';

const LOCAL_NAMES = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
  'GIT_INTERNAL_SUPER_PREFIX',
];
const RETAINED = {
  GIT_ASKPASS: 'askpass',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_GLOBAL: 'global',
  GIT_CONFIG_KEY_0: 'credential.helper',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_PARAMETERS: "'url.file:///fixture/.insteadOf=https://fixture/'",
  GIT_CONFIG_VALUE_0: 'helper',
  GIT_SSH_COMMAND: 'ssh -F custom',
  GIT_TERMINAL_PROMPT: '1',
  GIT_TRACE: '1',
  HTTPS_PROXY: 'proxy',
  PATH: 'path',
};

describe('git child environment', () => {
  it('removes every repository-local variable without mutating its parent', () => {
    expect.hasAssertions();
    const inherited = Object.fromEntries(LOCAL_NAMES.map((key) => [key, 'sentinel']));
    const env = { ...inherited, ...RETAINED };
    expect(gitEnvironment(env)).toStrictEqual(RETAINED);
    expect(env).toStrictEqual({ ...inherited, ...RETAINED });
  });

  it('recognizes mixed-case names only on Windows', () => {
    expect.hasAssertions();
    const env = { Git_Dir: 'sentinel', Path: 'path', git_index_file: 'index' };
    expect(gitEnvironment(env, 'win32')).toStrictEqual({ Path: 'path' });
    expect(gitEnvironment(env, 'linux')).toStrictEqual(env);
  });
});

describe('installed Git environment contract', () => {
  it('removes every repository variable Git reports except injected configuration', async () => {
    expect.hasAssertions();
    const { stdout } = await promisify(execFile)('git', ['rev-parse', '--local-env-vars']);
    const names = stdout.trim().split(/\r?\n/u);
    const inherited = Object.fromEntries(names.map((name) => [name, 'sentinel']));
    const retained = Object.keys(gitEnvironment(inherited));
    const injected = names.filter((name) =>
      ['GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS'].includes(name),
    );
    expect(retained.toSorted()).toStrictEqual(injected.toSorted());
  });
});
