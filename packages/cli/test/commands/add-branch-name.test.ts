import { EXIT, SpawnRunner } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import {
  initHome,
  parseLastEnvelope,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import { join, sep } from 'node:path';
import type { ErrorEnvelope } from '../helpers/add-support.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { mkdtemp } from 'node:fs/promises';
import { run } from '../../src/main.ts';
import { tmpdir } from 'node:os';

// A branch name is not ordinary text, and the value does not come from the person running `refs`:
// it is read from the repository's own `HEAD`. `git branch` will not create one beginning with
// `-`, but the ref FORMAT permits it and `update-ref` writes it, so a repository can have one and
// `HEAD` can point at it.
//
// Before this was refused, `refs add` recorded such a name and every later `refs sync` failed with
// `fatal: '--upload-pack=id' is not a valid branch name` — git complaining about a value nobody
// typed, one command after the one that could have said so.
//
// Built with real git rather than a fixture string, because what is under test is that a real
// repository can produce this and that refs now declines it at the point the user can still act.

const setupRunner = new SpawnRunner();
/** Shaped like a git option on purpose: this is the name that reaches an argv unterminated. */
const HOSTILE_BRANCH = '--upload-pack=id';

const repoWithHostileHead = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-hostile-head-'));
  const git = async (...args: string[]): Promise<void> => {
    await setupRunner.run('git', args, { cwd: dir });
  };
  await git('init', '-q', '-b', 'main', '.');
  await git(
    '-c',
    'user.email=t@example.com',
    '-c',
    'user.name=T',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'root',
  );
  // The low-level write `git branch` refuses, and then point HEAD at it.
  await git('update-ref', `refs/heads/${HOSTILE_BRANCH}`, 'HEAD');
  await git('symbolic-ref', 'HEAD', `refs/heads/${HOSTILE_BRANCH}`);
  return dir;
};

// POSIX only: a Windows temp path carries backslashes, and `file://C:\\Users\\…` is not a url refs
// accepts — the fixture cannot be built there at all. What is under test is refs' own decision,
// which does not vary by platform.
describe.skipIf(sep === '\\')('a repository whose HEAD names a branch git would not accept', () => {
  it(
    'is refused by the dry run, naming the field',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const source = await repoWithHostileHead();

          await run(ctx, ['node', 'refs', 'add', `file://${source}`, '--dry-run', '--json']);

          expect(process.exitCode).toBe(EXIT.VALIDATION);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.ok).toBe(false);
          const message = String(envelope.error?.message);
          // It has to name the value AND say where it came from: the branch was read from the
          // repository, not typed, so there is nothing in the command to correct.
          expect(message).toContain(HOSTILE_BRANCH);
          expect(message).toContain('comes from the repository');
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
