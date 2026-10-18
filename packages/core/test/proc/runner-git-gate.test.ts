import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GIT_2_54_REFUSAL } from '../../src/proc/git-version-gate.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { tmpdir } from 'node:os';

// A stand-in `git` first on PATH: it answers `--version` with the version under test and logs
// every other argv, so "refs never started the command" and "what refs passed" are both readable.
// POSIX only, because the stand-in is a shell script; the logic under test has no platform branch.

const SCRIPT_MODE = 0o755;
const isWindows = process.platform === 'win32';

const installFakeGit = async (version: string): Promise<{ dir: string; log: string }> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-fake-git-'));
  const log = join(dir, 'calls.log');
  await writeFile(log, '');
  const script =
    '#!/bin/sh\nfor last; do :; done\n' +
    `if [ "$last" = "--version" ]; then echo probe >> "${log}"; echo "git version ${version}"; exit 0; fi\n` +
    `echo "$*" >> "${log}"\n`;
  await writeFile(join(dir, 'git'), script);
  await chmod(join(dir, 'git'), SCRIPT_MODE);
  return { dir, log };
};

const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    process.env[name] = value;
  }
};

const kindOf = (call: string): string => {
  if (call === 'probe') {
    return call;
  }
  return call.endsWith(' config --list --show-origin -z')
    ? 'inventory'
    : (call.split(' ').pop() ?? '');
};

const linesOf = async (log: string): Promise<string[]> => {
  const text = await readFile(log, 'utf8');
  return text.split('\n').filter((line) => line !== '');
};

/** Runs `body` with a stand-in git for `version` first on PATH; resolves to its logged calls. */
const withFakeGit = async (version: string, body: () => Promise<void>): Promise<string[]> => {
  const { dir, log } = await installFakeGit(version);
  const previous = process.env['PATH'];
  process.env['PATH'] = `${dir}${delimiter}${previous ?? ''}`;
  try {
    await body();
  } finally {
    process.env['PATH'] = previous;
  }
  return linesOf(log);
};

describe.skipIf(isWindows)('the spawn runner on git 2.54.x', () => {
  it('refuses every git command except the version probe, and never starts it', async () => {
    expect.hasAssertions();
    const results: unknown[] = [];
    const calls = await withFakeGit('2.54.1', async () => {
      const runner = new SpawnRunner();
      results.push(await runner.run('git', ['status', '--porcelain']));
      await runner.run('git', ['fetch']);
      const version = await runner.run('git', ['--version']);
      results.push(version.stdout.trim());
    });

    expect(results).toStrictEqual([
      { exitCode: 1, stderr: GIT_2_54_REFUSAL, stdout: '' },
      'git version 2.54.1',
    ]);
    expect(calls).toStrictEqual(['probe', 'probe']);
  });
});

describe.skipIf(isWindows)('the spawn runner on other git versions', () => {
  it('probes once, then runs the command with the policy and the pinned hooks path', async () => {
    expect.hasAssertions();
    const calls = await withFakeGit('2.55.0', async () => {
      const runner = new SpawnRunner({ hooksDir: '/refs/hooks' });
      await runner.run('git', ['status']);
      await runner.run('git', ['fetch']);
    });

    const [probe, inventory, first, second] = calls;
    expect(probe).toBe('probe');
    expect(inventory).toMatch(/ config --list --show-origin -z$/u);
    expect(first).toMatch(/^-c core\.hooksPath=\/refs\/hooks -c core\.fsmonitor= .* status$/u);
    expect(first).toContain('-c hook.post-checkout.enabled=false');
    expect(second).toMatch(/ fetch$/u);
  });
});

describe.skipIf(isWindows)('the spawn runner’s hook label inventory', () => {
  it('is taken again only when the git configuration environment changes', async () => {
    expect.hasAssertions();
    const previous = process.env['GIT_CONFIG_GLOBAL'];
    const calls = await withFakeGit('2.56.0', async () => {
      const runner = new SpawnRunner();
      await runner.run('git', ['status']);
      await runner.run('git', ['status']);
      process.env['GIT_CONFIG_GLOBAL'] = '/elsewhere/gitconfig';
      await runner.run('git', ['status']);
      await runner.run('git', ['status']);
    }).finally(() => {
      restore('GIT_CONFIG_GLOBAL', previous);
    });

    const once = ['probe', 'inventory', 'status', 'status'];
    expect(calls.map((call) => kindOf(call))).toStrictEqual([...once, ...once]);
  });

  it('is not taken on git without configured hook labels', async () => {
    expect.hasAssertions();
    const calls = await withFakeGit('2.53.0', async () => {
      await new SpawnRunner().run('git', ['status']);
    });

    expect(calls.map((call) => kindOf(call))).toStrictEqual(['probe', 'status']);
  });
});

describe.skipIf(isWindows)('the spawn runner and other commands', () => {
  it('leaves non-git commands ungated', async () => {
    expect.hasAssertions();
    let stdout = '';
    const calls = await withFakeGit('2.54.0', async () => {
      const result = await new SpawnRunner().run('sh', ['-c', 'echo ok']);
      stdout = result.stdout.trim();
    });

    expect(stdout).toBe('ok');
    expect(calls).toStrictEqual([]);
  });
});
