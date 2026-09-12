import { describe, expect, it } from 'vitest';
import { SpawnRunner } from '@kaisers-io/refs-core';
import type { StructureIssue } from '../../src/commands/drift-report.ts';
import { driftLines } from '../../src/commands/drift-report.ts';

// Every drift finding that HAS a repair now prints it as a runnable command, not as a description
// of one.
//
// `unregistered` has printed `refs edit --create` since the probe shipped; `missing` and
// `relocated` said what was wrong and stopped. The asymmetry was not deliberate — the two repairs
// simply did not exist as commands yet. An agent reading "update the entry's path" had to work
// out the mode, the flag order, and the quoting itself, and the most likely thing it reached for
// instead was editing config.toml by hand.

const KEY = "github.com/acme/o'brien";
const SUCCESS = 0;
const runner = new SpawnRunner();

const lineFor = (issue: StructureIssue): string =>
  driftLines({ packages: [issue], status: 'drift' }, KEY)[0] ?? '';

/** The command a line ends with, run through a shell with `refs` swapped for a builtin that prints
 * its arguments one per line — so the assertion is about what the shell PARSED, not what was
 * printed. */
const argvThroughShell = async (line: string): Promise<string[]> => {
  const command = line.slice(line.indexOf('refs edit'));
  const result = await runner.run('sh', [
    '-c',
    command.replace(/^refs /u, String.raw`printf '%s\n' `),
  ]);
  expect(result.exitCode).toBe(SUCCESS);
  return result.stdout.split('\n').filter((token) => token.length > 0);
};

const posixOnly = process.platform === 'win32';

describe('a package that left the workspaces', () => {
  it('prints the unregister command', () => {
    expect.hasAssertions();

    const line = lineFor({
      configured_path: 'packages/gone',
      name: '@acme/gone',
      status: 'missing',
    });

    expect(line).toContain(
      String.raw`refs edit 'github.com/acme/o'\''brien' --package '@acme/gone' --remove`,
    );
  });

  it('still says the entry may only have moved out of them', () => {
    expect.hasAssertions();

    // Removal is one of two right answers. A package that moved out of the workspace patterns is
    // still there to be tracked, and unregistering it would lose a working entry.
    const line = lineFor({
      configured_path: 'packages/gone',
      name: '@acme/gone',
      status: 'missing',
    });

    expect(line).toContain('repoint the entry if it moved');
  });

  it.skipIf(posixOnly)('delivers a name needing quotes as one argument', async () => {
    expect.hasAssertions();

    const argv = await argvThroughShell(
      lineFor({ configured_path: 'packages/x', name: "@acme/o'brien", status: 'missing' }),
    );

    expect(argv).toStrictEqual(['edit', KEY, '--package', "@acme/o'brien", '--remove']);
  });
});

describe('a package that moved inside the repository', () => {
  it('prints the path edit as a command', () => {
    expect.hasAssertions();

    const line = lineFor({
      configured_path: 'packages/old',
      name: '@acme/moved',
      path: 'packages/new',
      status: 'relocated',
    });

    expect(line).toContain("path 'packages/new' --package '@acme/moved'");
  });

  it.skipIf(posixOnly)('never lets a substitution in the new path reach the shell', async () => {
    expect.hasAssertions();

    // `zPackagePath` permits `$()`, and the new path comes from a directory name inside an
    // untrusted checkout — quoting is the only thing between it and execution.
    const argv = await argvThroughShell(
      lineFor({
        configured_path: 'packages/old',
        name: '@acme/moved',
        path: 'packages/$(echo pwned)',
        status: 'relocated',
      }),
    );

    expect(argv).toContain('packages/$(echo pwned)');
    expect(argv).not.toContain('packages/pwned');
  });

  it('prints no command for a new path the configuration cannot hold', () => {
    expect.hasAssertions();

    // A command that fails validation is worse than none: it costs a run to find out, and the
    // finding itself is still true and still worth reading.
    const line = lineFor({
      configured_path: 'packages/old',
      name: '@acme/moved',
      path: 'packages/100%',
      status: 'relocated',
    });

    expect(line).toContain('moved to packages/100%');
    expect(line).not.toContain('refs edit');
  });
});
