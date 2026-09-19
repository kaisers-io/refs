import { FORGED_LINE, createFixtureRepo } from '../helpers/fixture-repo.ts';
import { describe, expect, it } from 'vitest';
import {
  initHome,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { run } from '../../src/main.ts';

// An ERROR message is the other place a checkout's own text is composed into refs' human output,
// and it is the one that keeps its line breaks: `refs add --description` against a monorepo
// refuses and prints the two-phase instructions, each on its own line, ending with the package
// names it wants described. Those names come from the manifests.
//
// So the neutralisation cannot be "strip every control character from the message" — that would
// run the instructions together — and it cannot be "trust the layout", either. The untrusted
// VALUES are neutralised before they are composed into the trusted layout, which is what this
// pins: the message still has exactly the lines refs wrote, and a manifest cannot add one.
//
// Driven through the CLI rather than through the composer, because what reaches the terminal is
// the thing under test.

const HUMAN_ARGV = ['node', 'refs', 'add'] as const;

const stderrTextOf = async (homeDir: string): Promise<string> => {
  const { ctx, stderr } = realContextFor(homeDir);
  await initHome(ctx);
  const fixture = await createFixtureRepo({ hostileMemberName: true, monorepo: true });
  await run(ctx, [...HUMAN_ARGV, fixture.url, '--description', 'A fixture monorepo.']);
  return stderr.join('\n');
};

describe('an error message cannot be restructured by a tracked repository', () => {
  it(
    'keeps the forged text inside a line instead of letting it be one',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const text = await stderrTextOf(homeDir);

          // Nothing is dropped: the reader still sees what the manifest said.
          expect(text).toContain(FORGED_LINE);
          // But it is not a line. Before the values were neutralised, `packages to describe: …`
          // ended with a name whose newline put the rest of it at column zero, indistinguishable
          // from a line refs wrote.
          expect(text.split('\n').some((line) => line.startsWith(FORGED_LINE))).toBe(false);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    "keeps refs' own instruction lines, which is why the whole message is not stripped",
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const text = await stderrTextOf(homeDir);

          // The two-phase flow is two commands, and each has to stay on its own line to be
          // runnable. Asserting this is what stops the fix from becoming "flatten the message".
          expect(text).toContain('--dry-run --json > proposal.json\n');
          expect(text).toContain('  refs add --proposal proposal.json\n');
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
