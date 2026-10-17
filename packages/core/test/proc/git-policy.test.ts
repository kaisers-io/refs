import { describe, expect, it, vi } from 'vitest';
import { gitArguments, withHooksPath } from '../../src/proc/git-policy.ts';
import type { Runner } from '../../src/proc/runner.ts';

const COMMAND_TAIL = -2;
const SETTINGS = ['gc.auto=0', 'maintenance.auto=false', 'submodule.recurse=false'];

describe('git invocation controls', () => {
  it('sets the safe empty monitor and avoids unrelated recursive work', () => {
    expect.hasAssertions();
    const args = gitArguments(['status', '--porcelain']);
    expect(args).toContain('core.fsmonitor=');
    for (const setting of SETTINGS) {
      expect(args).toContain(setting);
    }
    expect(args.slice(COMMAND_TAIL)).toStrictEqual(['status', '--porcelain']);
  });

  it('keeps the managed hooks path in command scope', () => {
    expect.hasAssertions();
    expect(gitArguments(['clone', 'url', 'dest'], '/managed hooks')).toContain(
      'core.hooksPath=/managed hooks',
    );
  });

  it('preserves run options while passing the hook path to the shared runner', async () => {
    expect.hasAssertions();
    const runner = {
      run: vi.fn<Runner['run']>().mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' }),
    };
    await withHooksPath(runner, '/hooks').run('git', ['status'], {
      cwd: '/checkout',
      timeoutMs: 1,
    });
    expect(runner.run).toHaveBeenCalledWith('git', ['status'], {
      cwd: '/checkout',
      gitHooksPath: '/hooks',
      timeoutMs: 1,
    });
  });
});
