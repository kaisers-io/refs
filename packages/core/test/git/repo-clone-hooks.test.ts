import { chmod, mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { cloneRepo } from '../../src/git/repo.ts';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

// `core.hooksPath` is refs' code-execution boundary for a checkout, and a clone is the one git
// Operation that materializes a tree BEFORE refs has had any chance to configure the new repo.
// Git resolves a RELATIVE `core.hooksPath` against the working tree, so an ambient user-level
// `.githooks` — a real convention — points every clone at hooks the cloned repo itself ships.
// These tests drive real git against a `file://` fixture, with the ambient config supplied through
// `GIT_CONFIG_GLOBAL` so the developer's own git config is never read or written.

const runner = new SpawnRunner();
const SUITE_OPTS = { timeout: SLOW_IO_TIMEOUT_MS };
const HOOK_MODE = 0o755;
const SUCCESS_EXIT_CODE = 0;

const git = async (dir: string, args: readonly string[]): Promise<void> => {
  const result = await runner.run('git', args, { cwd: dir });
  if (result.exitCode !== SUCCESS_EXIT_CODE) {
    throw new Error(`fixture git ${args.join(' ')} failed: ${result.stderr}`);
  }
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const writeRelativeHook = async (dir: string, markerPath: string): Promise<void> => {
  await mkdir(join(dir, '.githooks'), { recursive: true });
  const hook = join(dir, '.githooks', 'post-checkout');
  await writeFile(hook, `#!/bin/sh\nprintf ran > ${JSON.stringify(markerPath)}\n`);
  await chmod(hook, HOOK_MODE);
};

/** An upstream that tracks an executable `.githooks/post-checkout` writing `markerPath`. */
const upstreamTrackingHook = async (markerPath: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-hookfixture-'));
  await writeRelativeHook(dir, markerPath);
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'fixture@example.com']);
  await git(dir, ['config', 'user.name', 'Fixture']);
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'tracks a relative hook']);
  return dir;
};

/** A git config file setting a RELATIVE `core.hooksPath`, as a user might have globally. */
const relativeHooksPathConfig = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-gitconfig-'));
  const path = join(dir, 'gitconfig');
  await writeFile(path, '[core]\n\thooksPath = .githooks\n');
  return path;
};

describe('cloneRepo under an ambient relative core.hooksPath', SUITE_OPTS, () => {
  it('does not let the cloned repo own hooks run during the clone', async () => {
    expect.hasAssertions();
    const scratch = await mkdtemp(join(tmpdir(), 'refs-hookmarker-'));
    const marker = join(scratch, 'upstream-hook-ran');
    const upstream = await upstreamTrackingHook(marker);
    const previous = process.env['GIT_CONFIG_GLOBAL'];
    process.env['GIT_CONFIG_GLOBAL'] = await relativeHooksPathConfig();
    try {
      await cloneRepo(runner, {
        cloneUrl: pathToFileURL(upstream).href,
        dest: join(scratch, 'checkout'),
        hooksDir: join(scratch, 'refs-hooks'),
        mode: 'full',
      });
      await expect(exists(marker)).resolves.toBe(false);
    } finally {
      process.env['GIT_CONFIG_GLOBAL'] = previous;
    }
  });

  it('leaves the managed marker on the checkout it produced', async () => {
    expect.hasAssertions();
    const scratch = await mkdtemp(join(tmpdir(), 'refs-hookmarker-'));
    const upstream = await upstreamTrackingHook(join(scratch, 'unused'));
    const dest = join(scratch, 'checkout');
    const hooksDir = join(scratch, 'refs-hooks');
    await cloneRepo(runner, {
      cloneUrl: pathToFileURL(upstream).href,
      dest,
      hooksDir,
      mode: 'full',
    });
    const read = await runner.run('git', ['config', '--local', '--get', 'core.hooksPath'], {
      cwd: dest,
    });
    expect(read.stdout.trim()).toBe(hooksDir);
  });
});
