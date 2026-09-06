import { describe, expect, it } from 'vitest';
import { SpawnRunner } from '@kaisers-io/refs-core';
import { driftLines } from '../../src/commands/drift-report.ts';

// What the printed repair command survives when a package name or path needs quoting.
//
// Run through `sh -c`, because a shell is the thing the line has to survive: asserting on the
// string only proves it looks right. `echo`-ing the arguments back shows what the CLI would
// actually receive.

const SUCCESS = 0;
const runner = new SpawnRunner();

/** The repair command from one finding, with `refs` swapped for a shell builtin that prints its
 * arguments one per line — so the assertion is about what the shell PARSED, not what was typed. */
const argvThroughShell = async (name: string, path: string): Promise<string[]> => {
  const [line] = driftLines(
    { packages: [{ name, path, status: 'unregistered' }], status: 'drift' },
    "github.com/acme/o'brien",
  );
  const marker = 'To register it: ';
  const command = (line ?? '').slice((line ?? '').indexOf(marker) + marker.length);
  // `printf` in place of `refs`, so the assertion is about what the shell PARSED into arguments.
  const result = await runner.run('sh', [
    '-c',
    command.replace(/^refs /u, String.raw`printf '%s\n' `),
  ]);
  expect(result.exitCode).toBe(SUCCESS);
  return result.stdout.split('\n').filter((token) => token.length > 0);
};

describe('the printed repair command, through a shell', () => {
  it('delivers a package name containing a quote intact', async () => {
    expect.hasAssertions();

    const argv = await argvThroughShell("@acme/o'brien", 'packages/ok');

    // `shellQuote` closes and reopens around the embedded quote. Unquoted, the shell would swallow
    // it and hand the CLI a different package name.
    expect(argv).toContain("@acme/o'brien");
  });

  it('delivers a path containing a space as ONE argument', async () => {
    expect.hasAssertions();

    const argv = await argvThroughShell('@acme/spaced', 'packages/with space');

    expect(argv).toContain('packages/with space');
  });

  it('delivers the ref key intact, quote and all', async () => {
    expect.hasAssertions();

    const argv = await argvThroughShell('@acme/plain', 'packages/plain');

    // The key is interpolated into the same line, so it needs the same treatment.
    expect(argv).toContain("github.com/acme/o'brien");
  });

  it('never lets a substitution reach the shell', async () => {
    expect.hasAssertions();

    // `zPackagePath` permits `$()`; single quotes are what stop the shell running it.
    const argv = await argvThroughShell('@acme/subst', 'packages/$(echo pwned)');

    expect(argv).toContain('packages/$(echo pwned)');
    expect(argv).not.toContain('packages/pwned');
  });
});
