import { PACKAGE_NAME, REF_KEY, setupEditFixture } from '../helpers/edit-support.ts';
import { SpawnRunner, readConfig, resolveHome } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import type { StructureIssue } from '../../src/commands/drift-report.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { driftLines } from '../../src/commands/drift-report.ts';
import { run } from '../../src/main.ts';

// Every drift finding that HAS a repair now prints it as a runnable command, not as a description
// of one.
//
// `unregistered` has printed `refs edit --create` since the probe shipped; `missing` and
// `relocated` said what was wrong and stopped. The asymmetry was not deliberate — the two repairs
// simply did not exist as commands yet. An agent reading "update the entry's path" had to work
// out the mode, the flag order, and the quoting itself, and the most likely thing it reached for
// instead was editing config.toml by hand.

const KEY = "github.com/acme/o'brien";
const LAST = -1;
const SUCCESS = 0;
const runner = new SpawnRunner();

const lineFor = (issue: StructureIssue): string => lineForKey(issue, KEY);

/** Same, for a case that needs the line to name a ref a fixture actually has. */
const lineForKey = (issue: StructureIssue, key: string): string =>
  driftLines({ packages: [issue], status: 'drift' }, key)[0] ?? '';

/** The command a line ends with, run through a shell with `refs` swapped for a builtin that prints
 * its arguments one per line — so the assertion is about what the shell PARSED, not what was
 * printed. */
const shellSplit = async (command: string): Promise<string[]> => {
  const result = await runner.run('sh', [
    '-c',
    command.replace(/^refs /u, String.raw`printf '%s\n' refs `),
  ]);
  expect(result.exitCode).toBe(SUCCESS);
  return result.stdout.split('\n').filter((token) => token.length > 0);
};

const argvThroughShell = async (line: string): Promise<string[]> => {
  const argv = await shellSplit(line.slice(line.indexOf('refs edit')));
  return argv.slice(1);
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
      String.raw`refs edit --package='@acme/gone' --remove 'github.com/acme/o'\''brien'`,
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

    expect(argv).toStrictEqual(['edit', "--package=@acme/o'brien", '--remove', KEY]);
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

    expect(line).toContain("--package='@acme/moved'");
    expect(line).toContain("'path' 'packages/new'");
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

// The command has TWO parsers to survive, and quoting only answers the first. `zPackagePath`
// admits `-new/pkg`, and `refs edit '<key>' path '-new/pkg' --package '<name>'` — the spelling
// this file printed before — reaches refs' own parser intact and exits 2 with
// `unknown option '-new/pkg'`. Nothing about the quoting is wrong; the argument is simply in a
// position where a leading `-` means something else.
describe('a value that begins with a hyphen', () => {
  it('reaches the CLI as a positional, not as an option', async () => {
    expect.hasAssertions();

    const argv = await argvThroughShell(
      lineFor({
        configured_path: 'packages/old',
        name: '@acme/moved',
        path: '-new/pkg',
        status: 'relocated',
      }),
    );

    // `--` is what makes the difference: everything after it is a positional, whatever it starts
    // with.
    expect(argv.indexOf('--')).toBeLessThan(argv.indexOf('-new/pkg'));
  });

  it('leaves an ordinary command free of the terminator, so a flag can still be appended', () => {
    expect.hasAssertions();

    // Everything after `--` is a positional. An agent appending `--json` to a line that carries
    // one would get `too many arguments`, so the terminator is printed only where a value would
    // otherwise be misread.
    const line = lineFor({ configured_path: 'packages/x', name: '@acme/gone', status: 'missing' });

    expect(line).not.toContain(' -- ');
  });

  it('carries a package name that begins with a hyphen as an attached option value', async () => {
    expect.hasAssertions();

    // An option's own value cannot hide behind `--`; `--package=-odd` is the spelling that keeps
    // it one argument.
    const argv = await argvThroughShell(
      lineFor({ configured_path: 'packages/x', name: '-odd', status: 'missing' }),
    );

    expect(argv).toContain('--package=-odd');
  });
});

// The one test that would have caught the hyphen bug on its own: the printed command is split by a
// real shell and then handed to the real CLI. Asserting on the string proves it looks right, and
// `printf` proves the shell parses it right — neither reaches the parser that actually rejected it.
describe.skipIf(posixOnly)('the printed command, run against the CLI', () => {
  it('repoints an entry whose new path begins with a hyphen', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx } = await setupEditFixture(homeDir);
        const line = lineForKey(
          {
            configured_path: 'packages/pkg',
            name: PACKAGE_NAME,
            path: '-new/pkg',
            status: 'relocated',
          },
          REF_KEY,
        );
        const argv = await shellSplit(line.slice(line.indexOf('refs edit')));

        // No `--json` appended: everything after `--` is a positional, which is the whole point.
        await run(ctx, ['node', ...argv]);

        const config = await readConfig(resolveHome(ctx.env));
        expect(config.refs[REF_KEY]?.packages?.[PACKAGE_NAME]?.path).toBe('-new/pkg');
      }),
    );
  });
});

// A name the packages RECORD cannot hold is still a name the declined LIST can: one is keyed, the
// other is an array of records. Gating both commands on registrability left exactly the findings
// that recur forever — a workspace member legitimately named `constructor` — with no answer at
// all, which is the problem the decline was added to solve.
describe('a package the configuration cannot register', () => {
  it('still offers the decision, when only the name is the obstacle', () => {
    expect.hasAssertions();

    const line = lineFor({ name: 'constructor', path: 'packages/ctor', status: 'unregistered' });

    expect(line).toContain('--decline');
    expect(line).not.toContain('--create');
  });

  it('offers nothing when the PATH is the obstacle', () => {
    expect.hasAssertions();

    // A decline is stored with the same `zPackagePath` a registration uses, so a path the schema
    // rejects has no command either — and printing one that fails validation is worse than none.
    const line = lineFor({ name: '@acme/ok', path: 'packages/100%', status: 'unregistered' });

    expect(line).not.toContain('refs edit');
  });
});

// A repository declaring a recursive workspace pattern can legitimately have hundreds of members
// — astro has 554, and pnpm agrees — so a ref tracking three of them would otherwise print 551
// repair commands into one `doctor` line.
const many = (count: number): StructureIssue[] =>
  Array.from({ length: count }, (_unused, index) => ({
    name: `@acme/pkg-${index}`,
    path: `packages/pkg-${index}`,
    status: 'unregistered' as const,
  }));

describe('a ref with more findings than anyone will read', () => {
  it('stops printing after ten and says how many it held back', () => {
    expect.hasAssertions();
    const ELEVEN = 11;
    const CAPPED = 11;

    const lines = driftLines({ packages: many(ELEVEN), status: 'drift' }, KEY);

    expect(lines).toHaveLength(CAPPED);
    expect(lines.at(LAST)).toContain('…and 1 more finding(s)');
    // The KEY, not a `<ref>` placeholder: a shell reads `<ref>` as an input redirection, so a
    // line carrying one cannot be pasted — the exact defect a printed command shipped with once.
    expect(lines.at(LAST)).toContain(String.raw`refs sync 'github.com/acme/o'\''brien' --json`);
  });

  it('prints every finding when there are few enough to read', () => {
    expect.hasAssertions();
    const THREE = 3;

    const lines = driftLines({ packages: many(THREE), status: 'drift' }, KEY);

    expect(lines).toHaveLength(THREE);
  });

  it('never lets the cap crowd out a problem with a package the ref tracks', () => {
    expect.hasAssertions();
    const MANY = 30;

    // Configured entries are classified before discovery runs, so they arrive first — a `missing`
    // package must not be the one that falls off the end.
    const lines = driftLines(
      {
        packages: [
          { configured_path: 'packages/gone', name: '@acme/gone', status: 'missing' },
          ...many(MANY),
        ],
        status: 'drift',
      },
      KEY,
    );

    expect(lines[0]).toContain('@acme/gone');
  });
});
