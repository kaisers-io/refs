import { GIT_EXEC_POLICY_ARGS, withGitExecPolicy } from '../../src/proc/git-exec-policy.ts';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { tmpdir } from 'node:os';

// What reaches a git process. `repo-exec-policy.test.ts` shows the effect against real git; this
// pins the argv itself, for EVERY git call — including the ones no repo function makes — by
// putting a `git` first on PATH that prints the arguments it was given.

const SCRIPT_MODE = 0o755;
const OPTION_AND_VALUE = 2;

const withEchoGit = async (body: () => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-echogit-'));
  await writeFile(join(dir, 'git'), '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\n');
  await chmod(join(dir, 'git'), SCRIPT_MODE);
  const previous = process.env['PATH'];
  process.env['PATH'] = `${dir}${delimiter}${previous ?? ''}`;
  try {
    await body();
  } finally {
    process.env['PATH'] = previous;
  }
};

describe('the git execution policy SpawnRunner applies', () => {
  it('puts the policy before the subcommand of every git it starts', async () => {
    expect.hasAssertions();
    await withEchoGit(async () => {
      const result = await new SpawnRunner().run('git', ['status', '--porcelain']);
      expect(result.stdout.split('\n').filter(Boolean)).toStrictEqual([
        ...GIT_EXEC_POLICY_ARGS,
        'status',
        '--porcelain',
      ]);
    });
  });

  it('empties fsmonitor, never sets it to false', () => {
    expect.hasAssertions();
    // git 2.35.1 and older read `false` as a hook pathname and try to run it.
    expect(GIT_EXEC_POLICY_ARGS).toContain('core.fsmonitor=');
    expect(GIT_EXEC_POLICY_ARGS.join(' ')).not.toMatch(/core\.fsmonitor=false/u);
  });

  it.each(['post-checkout', 'post-index-change', 'pre-auto-gc', 'reference-transaction'])(
    'switches off configured hooks for %s, an event refs causes',
    (event) => {
      expect.hasAssertions();
      expect(GIT_EXEC_POLICY_ARGS).toContain(`hook.${event}.enabled=false`);
    },
  );

  it('passes every option as -c, so each one is top-level', () => {
    expect.hasAssertions();
    const flags = GIT_EXEC_POLICY_ARGS.filter((_arg, index) => index % OPTION_AND_VALUE === 0);
    expect(new Set(flags)).toStrictEqual(new Set(['-c']));
  });

  it('leaves a program that is not git alone', () => {
    expect.hasAssertions();
    expect(withGitExecPolicy('ssh', ['-V'])).toStrictEqual(['-V']);
  });
});
