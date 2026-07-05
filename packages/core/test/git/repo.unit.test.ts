import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { FakeRunner } from '../../src/proc/fake-runner.ts';
import { join } from 'node:path';
import { syncRef } from '../../src/git/repo.ts';
import { tmpdir } from 'node:os';

// Scripted-runner unit suite for `syncRef()` branches the real-git integration suite
// (`repo.test.ts`) can't easily force — a healthy local fixture repo never makes
// `git remote set-head origin --auto` fail, so this covers that branch with a `FakeRunner`
// Instead. `syncRef`'s managed-checkout guard does a real fs check (`isGitCheckout`), so the
// Scripted checkout still needs a real `.git` directory on disk.

const CLEAN_SHA = 'aaaaaaa';
const ONE_CALL = 1;

const makeManagedCheckoutDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-unit-checkout-'));
  await mkdir(join(dir, '.git'));
  return dir;
};

// Scripts a full clean-sync sequence (managed checkout, no rename, nothing dirty) EXCEPT
// `git remote set-head origin --auto` fails — the branch under test in the first case below.
const scriptCleanSyncWithFailedSetHead = (runner: FakeRunner): void => {
  runner.expect('git config --local --get core.hooksPath', { stdout: '/managed/hooks\n' });
  runner.expect('git rev-parse HEAD', { stdout: `${CLEAN_SHA}\n` });
  runner.expect('git fetch', {});
  runner.expect('git remote set-head origin --auto', {
    exitCode: 1,
    stderr: 'fatal: could not refresh origin/HEAD\n',
  });
  runner.expect('git symbolic-ref --short refs/remotes/origin/HEAD', { stdout: 'main\n' });
  runner.expect('git status --porcelain', { stdout: '' });
  runner.expect('git checkout -B main origin/main', {});
  runner.expect('git reset --hard origin/main', {});
  runner.expect('git rev-parse HEAD', { stdout: `${CLEAN_SHA}\n` });
};

describe('syncRef() set-head refresh failure', () => {
  it('does not throw when `git remote set-head --auto` fails, and surfaces a warning instead', async () => {
    expect.hasAssertions();
    const dir = await makeManagedCheckoutDir();
    const runner = new FakeRunner();
    scriptCleanSyncWithFailedSetHead(runner);

    const result = await syncRef(runner, { defaultBranch: 'main', dir });

    expect(result.status).toBe('fresh');
    expect(result.branchRenamedTo).toBeUndefined();
    expect(result.warning).toMatch(/could not refresh origin\/HEAD/u);
    expect(result.warning).toMatch(/fatal: could not refresh origin\/HEAD/u);
  });

  it('rejects an unmanaged checkout (no core.hooksPath set) before running any destructive command', async () => {
    expect.hasAssertions();
    const dir = await makeManagedCheckoutDir();
    const runner = new FakeRunner();
    runner.expect('git config --local --get core.hooksPath', { exitCode: 1, stderr: 'not set\n' });

    await expect(syncRef(runner, { defaultBranch: 'main', dir })).rejects.toThrow(
      /not a refs-managed checkout/u,
    );
    expect(runner.calls).toHaveLength(ONE_CALL);
  });
});
