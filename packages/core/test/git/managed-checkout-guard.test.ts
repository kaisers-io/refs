import { addCommit, createFixtureRepo } from '../helpers/fixture-repo.ts';
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { join } from 'node:path';
import { syncRef } from '../../src/git/repo.ts';
import { tmpdir } from 'node:os';

// The guard `syncRef` applies immediately before `checkout -B`, `reset --hard` and `clean -fd`.
//
// It used to accept ANY non-empty local `core.hooksPath`, while its three siblings — `add`'s,
// `doctor`'s and `resolve`'s — compare for equality with this home's hooks directory, which is
// what `cloneRepo` actually stamps. Its own doc comment described the strict check, which is an
// invitation to add the second caller that would make the weak predicate the operative one.
//
// Split from `repo.test.ts` for the 300-line cap.

const SUITE_OPTS = { timeout: SLOW_IO_TIMEOUT_MS };
const SUCCESS_EXIT_CODE = 0;

const runner = new SpawnRunner();

/** What `cloneRepo` would have stamped, and what `syncRef` is told to require. */
const MANAGED_HOOKS_MARKER = '/managed-checkout-marker';

const makeDest = (): Promise<string> => mkdtemp(join(tmpdir(), 'refs-guard-dest-'));

const plainClone = async (url: string, dest: string): Promise<void> => {
  const result = await runner.run('git', ['clone', '-q', url, dest]);
  if (result.exitCode !== SUCCESS_EXIT_CODE) {
    throw new Error(`test setup clone failed: ${result.stderr}`);
  }
};

const headSha = async (dir: string): Promise<string> => {
  const result = await runner.run('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return result.stdout.trim();
};

/** Sets the local marker, asserting the setup command itself succeeded — a silently failed
 * `git config` would make the case under test vacuous. */
const setMarker = async (dest: string, value: string): Promise<void> => {
  const result = await runner.run('git', ['config', '--local', 'core.hooksPath', value], {
    cwd: dest,
  });
  expect(result.exitCode).toBe(SUCCESS_EXIT_CODE);
};

/** A clone with local work in it, plus an upstream commit it has not seen — so a sync that got
 * past the guard would visibly change all three. */
const checkoutWithLocalWork = async (): Promise<{ dest: string; shaBefore: string }> => {
  const fixture = await createFixtureRepo();
  const dest = await makeDest();
  await plainClone(fixture.url, dest);
  await plantLocalWork(dest);
  const shaBefore = await headSha(dest);
  await addCommit(fixture.dir, 'more.txt', 'more content\n');
  return { dest, shaBefore };
};

/** A tracked edit and an untracked file: what `reset --hard` and `clean -fd` would take. An
 * unchanged HEAD alone does not establish that the working tree was left alone. */
const plantLocalWork = async (dest: string): Promise<void> => {
  await writeFile(join(dest, 'foo.txt'), 'local edit\n', 'utf8');
  await writeFile(join(dest, 'scratch.txt'), 'untracked\n', 'utf8');
};

const expectLocalWorkIntact = async (dest: string): Promise<void> => {
  await expect(readFile(join(dest, 'foo.txt'), 'utf8')).resolves.toBe('local edit\n');
  await expect(readFile(join(dest, 'scratch.txt'), 'utf8')).resolves.toBe('untracked\n');
};

/** `syncRef` against a checkout, with the hooks directory the marker must match. */
const syncManaged = (dir: string) =>
  syncRef(runner, { defaultBranch: 'main', dir, hooksDir: MANAGED_HOOKS_MARKER });

describe('syncRef() managed-checkout guard', SUITE_OPTS, () => {
  it('rejects an unmanaged (plain) git checkout without touching it', async () => {
    expect.hasAssertions();
    const { dest, shaBefore } = await checkoutWithLocalWork();

    await expect(syncManaged(dest)).rejects.toThrow(/not a refs-managed checkout/u);

    await expect(headSha(dest)).resolves.toBe(shaBefore);
    await expectLocalWorkIntact(dest);
  });

  it('rejects a checkout whose core.hooksPath points somewhere else, without touching it', async () => {
    expect.hasAssertions();
    const { dest, shaBefore } = await checkoutWithLocalWork();
    // Non-empty, and a real marker — it is simply ANOTHER home's. This is what the old predicate
    // accepted, in the position nearest the destructive sequence.
    await setMarker(dest, '/another/home/hooks');

    await expect(syncManaged(dest)).rejects.toThrow(/not a refs-managed checkout/u);

    await expect(headSha(dest)).resolves.toBe(shaBefore);
    await expectLocalWorkIntact(dest);
  });
});

describe('syncRef() guard: an unstamped marker', SUITE_OPTS, () => {
  it('is rejected even when the hooks directory it is given is empty too', async () => {
    expect.hasAssertions();
    const { dest } = await checkoutWithLocalWork();
    // `git config` answers exit 0 with an empty value for a key explicitly set to nothing, so
    // equality alone would accept an unstamped checkout from a caller that passed nothing —
    // precisely the class of caller this guard exists to protect against.
    await setMarker(dest, '');

    await expect(
      syncRef(runner, { defaultBranch: 'main', dir: dest, hooksDir: '' }),
    ).rejects.toThrow(/not a refs-managed checkout/u);

    await expectLocalWorkIntact(dest);
  });
});

describe('syncRef() guard: a matching marker', SUITE_OPTS, () => {
  it('is accepted, and the sync proceeds', async () => {
    expect.hasAssertions();
    const fixture = await createFixtureRepo();
    const dest = await makeDest();
    await plainClone(fixture.url, dest);
    await setMarker(dest, MANAGED_HOOKS_MARKER);
    const shaBefore = await headSha(dest);
    await addCommit(fixture.dir, 'more.txt', 'more content\n');

    const result = await syncManaged(dest);

    expect(result.status).toBe('updated');
    expect(result.newSha).not.toBe(shaBefore);
  });
});
