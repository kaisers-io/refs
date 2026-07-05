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
const NEW_SHA = 'bbbbbbb';
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

// Task 10 gap: `resolveSyncBranch` re-detects the default branch every sync (`origin/HEAD` refresh
// + `symbolic-ref`) and reports a rename via `branchRenamedTo` when it no longer matches the
// PREVIOUSLY-configured `opts.defaultBranch` — the real-git integration suite never forces a
// rename (its fixture repo's default branch never moves mid-test), so this scripts one instead: a
// checkout configured for `master` whose remote's default branch has since moved to `main`.
const scriptRenamedDefaultBranch = (runner: FakeRunner): void => {
  runner.expect('git config --local --get core.hooksPath', { stdout: '/managed/hooks\n' });
  runner.expect('git rev-parse HEAD', { stdout: `${CLEAN_SHA}\n` });
  runner.expect('git fetch', {});
  runner.expect('git remote set-head origin --auto', {});
  runner.expect('git symbolic-ref --short refs/remotes/origin/HEAD', { stdout: 'origin/main\n' });
  runner.expect('git status --porcelain', { stdout: '' });
  runner.expect('git checkout -B main origin/main', {});
  runner.expect('git reset --hard origin/main', {});
  runner.expect('git rev-parse HEAD', { stdout: `${NEW_SHA}\n` });
};

describe('syncRef() default-branch rename detection', () => {
  it('reports branchRenamedTo when the remote default branch no longer matches the configured one', async () => {
    expect.hasAssertions();
    const dir = await makeManagedCheckoutDir();
    const runner = new FakeRunner();
    scriptRenamedDefaultBranch(runner);

    const result = await syncRef(runner, { defaultBranch: 'master', dir });

    expect(result.branchRenamedTo).toBe('main');
    expect(result.status).toBe('updated');
    expect(result.warning).toBeUndefined();
  });
});

// The dirty-checkout cleanup pair `syncRef` runs before `checkout -B` (see `dirtyCleanupSteps` in
// `git/repo.ts`) — factored out purely to keep `scriptDirtySyncWithFailedSetHead` below under the
// repo's max-statements cap.
const scriptDirtyCleanup = (runner: FakeRunner): void => {
  runner.expect('git reset --hard HEAD', {});
  runner.expect('git clean -fd', {});
};

// Task 10 gap: `buildSyncResult` merges a restore warning (dirty checkout) with a set-head-refresh
// warning (`setHeadWarning`) rather than one replacing the other — the real-git suite and the
// set-head-only unit test above each force only ONE of the two conditions, so neither exercises the
// branch where both fire in the SAME sync.
const scriptDirtySyncWithFailedSetHead = (runner: FakeRunner): void => {
  runner.expect('git config --local --get core.hooksPath', { stdout: '/managed/hooks\n' });
  runner.expect('git rev-parse HEAD', { stdout: `${CLEAN_SHA}\n` });
  runner.expect('git fetch', {});
  runner.expect('git remote set-head origin --auto', {
    exitCode: 1,
    stderr: 'fatal: could not refresh origin/HEAD\n',
  });
  runner.expect('git symbolic-ref --short refs/remotes/origin/HEAD', { stdout: 'main\n' });
  runner.expect('git status --porcelain', { stdout: ' M dirty-file.txt\n' });
  scriptDirtyCleanup(runner);
  runner.expect('git checkout -B main origin/main', {});
  runner.expect('git reset --hard origin/main', {});
  runner.expect('git rev-parse HEAD', { stdout: `${NEW_SHA}\n` });
};

describe('syncRef() combined dirty-checkout + set-head-refresh-failure warning', () => {
  it('merges the restore warning and the set-head-refresh warning into one `warning` string', async () => {
    expect.hasAssertions();
    const dir = await makeManagedCheckoutDir();
    const runner = new FakeRunner();
    scriptDirtySyncWithFailedSetHead(runner);

    const result = await syncRef(runner, { defaultBranch: 'main', dir });

    expect(result.status).toBe('restored');
    expect(result.warning).toMatch(/read-only/u);
    expect(result.warning).toMatch(/could not refresh origin\/HEAD/u);
  });
});
