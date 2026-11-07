import { addRefViaDescription, gitFor } from '../helpers/sync-support.ts';
import { chmod, mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { expectCheck, runDoctorJson } from '../helpers/doctor-support.ts';
import {
  initHome,
  realContextFor,
  runAddDryRunJson,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import type { CliContext } from '../../src/context.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { join } from 'node:path';
import { resolveHome } from '@kaisers-io/refs-core';

// #249 pinned `core.hooksPath` at command scope for clone and sync, because refs passes an
// inherited `GIT_CONFIG_PARAMETERS` / `GIT_CONFIG_COUNT` through and command-scope configuration
// outranks the checkout's local marker. Two git calls outside clone and sync still ran without the
// pin, each from a hook the checkout ITSELF tracks under an inherited `core.hooksPath=.githooks`:
// doctor's `git status` (an index refresh runs `post-index-change`) and the `remote set-head`
// fallback when `origin/HEAD` is missing (from git 2.54 the ref update runs
// `reference-transaction`). Driven through the CLI against real git.

const SUITE_OPTS = { timeout: SLOW_IO_TIMEOUT_MS };
const HOOK_MODE = 0o755;
const HOOK_NAMES = ['post-index-change', 'reference-transaction', 'post-checkout'] as const;
// Far enough from now that the index's cached stat data is stale whatever the clock did.
const STALE_MTIME_S = 1_000_000_000;

const INHERITED = {
  GIT_CONFIG_COUNT: {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: '.githooks',
  },
  GIT_CONFIG_PARAMETERS: { GIT_CONFIG_PARAMETERS: "'core.hookspath'='.githooks'" },
} as const;

type Vars = Record<string, string>;

const readMarker = async (marker: string): Promise<string> => {
  try {
    return await readFile(marker, 'utf8');
  } catch {
    return '';
  }
};

/** An upstream whose tracked `.githooks/` holds every hook the two calls could reach; each one
 * appends its own name to `marker`, a sibling of the fixture and so outside every checkout. */
const upstreamTrackingHooks = async (): Promise<{ marker: string; url: string }> => {
  const { dir, url } = await createFixtureRepo();
  const marker = `${dir}.hook-ran`;
  await mkdir(join(dir, '.githooks'));
  for (const name of HOOK_NAMES) {
    const hook = join(dir, '.githooks', name);
    // eslint-disable-next-line no-await-in-loop -- three tiny fixture writes
    await writeFile(hook, `#!/bin/sh\necho ${name} >> ${JSON.stringify(marker)}\n`);
    // eslint-disable-next-line no-await-in-loop -- three tiny fixture writes
    await chmod(hook, HOOK_MODE);
  }
  await gitFor(dir, ['add', '-A']);
  await gitFor(dir, ['commit', '-q', '-m', 'track relative hooks']);
  return { marker, url };
};

const withEnv = async <Result>(vars: Vars, exercise: () => Promise<Result>): Promise<Result> => {
  const previous = Object.keys(vars).map((name) => [name, process.env[name]] as const);
  Object.assign(process.env, vars);
  try {
    return await exercise();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name);
      } else {
        process.env[name] = value;
      }
    }
  }
};

/** Records every argv `ctx.runner` is handed, so the pin is asserted even on a git that runs no
 * hook for the call (git 2.43 runs none for `set-head`). */
const recordArgv = (ctx: CliContext): string[][] => {
  const calls: string[][] = [];
  const inner = ctx.runner;
  ctx.runner = {
    run: (cmd, args, opts) => {
      calls.push([cmd, ...args]);
      return inner.run(cmd, args, opts);
    },
  };
  return calls;
};

const doctorAfterStaleStat = async (homeDir: string, vars: Vars): Promise<void> => {
  const { ctx, stdout } = realContextFor(homeDir);
  await initHome(ctx);
  const upstream = await upstreamTrackingHooks();
  const added = await addRefViaDescription(ctx, stdout, upstream.url);
  await utimes(join(added.dest, 'README.md'), STALE_MTIME_S, STALE_MTIME_S);

  const envelope = await withEnv(vars, () => runDoctorJson(ctx, stdout));

  await expect(readMarker(upstream.marker)).resolves.toBe('');
  expectCheck(envelope, 'dirty-checkouts', { status: 'ok' });
};

/** A checkout `add --dry-run` produced and will reuse, with its `origin/HEAD` gone. */
const checkoutWithoutOriginHead = async (homeDir: string) => {
  const { ctx, stdout } = realContextFor(homeDir);
  await initHome(ctx);
  const upstream = await upstreamTrackingHooks();
  const { key } = await runAddDryRunJson(ctx, stdout, upstream.url);
  const dest = join(resolveHome(ctx.env).sourcesDir, ...key.split('/'));
  await gitFor(dest, ['symbolic-ref', '-d', 'refs/remotes/origin/HEAD']);
  return { ctx, dest, stdout, upstream };
};

const dryRunWithoutOriginHead = async (homeDir: string, vars: Vars): Promise<void> => {
  const { ctx, dest, stdout, upstream } = await checkoutWithoutOriginHead(homeDir);
  const calls = recordArgv(ctx);

  const proposal = await withEnv(vars, () => runAddDryRunJson(ctx, stdout, upstream.url));

  await expect(readMarker(upstream.marker)).resolves.toBe('');
  expect(calls.filter((argv) => argv.includes('set-head'))).toStrictEqual([
    expect.arrayContaining([`core.hooksPath=${resolveHome(ctx.env).hooksDir}`]),
  ]);
  expect(proposal.default_branch).toBe('main');
  await expect(gitFor(dest, ['symbolic-ref', 'refs/remotes/origin/HEAD'])).resolves.toBe(
    'refs/remotes/origin/main',
  );
};

describe.each(Object.entries(INHERITED))('under an inherited %s core.hooksPath', (_name, vars) => {
  it('refs doctor inspects a checkout without running its hooks', SUITE_OPTS, async () => {
    expect.hasAssertions();
    await withResetExitCode(() => withTempHome((homeDir) => doctorAfterStaleStat(homeDir, vars)));
  });

  it(
    'add --dry-run restores a missing origin/HEAD without running its hooks',
    SUITE_OPTS,
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome((homeDir) => dryRunWithoutOriginHead(homeDir, vars)),
      );
    },
  );
});
