import { describe, expect, it } from 'vitest';
import type { StructureIssue } from '../../src/commands/drift-report.ts';
import { repairCommandsFor } from '../../src/commands/drift-commands.ts';

// The repair commands a finding can offer, as strings — one place, so the human line and the
// `--json` finding cannot differ about what to run. What each status offers, and where it honestly
// offers nothing, is the whole contract.

const KEY = 'github.com/acme/alpha';

const commandsFor = (issue: StructureIssue): Record<string, string> =>
  repairCommandsFor(issue, KEY) as Record<string, string>;

describe('what a finding can offer', () => {
  it('offers both answers for an unregistered package', () => {
    expect.hasAssertions();

    const commands = commandsFor({
      name: '@acme/new',
      path: 'packages/new',
      status: 'unregistered',
    });

    expect(commands['register']).toContain('--create');
    expect(commands['decline']).toContain('--decline');
  });

  it('offers only the decline for a name the packages table cannot hold', () => {
    expect.hasAssertions();

    // `constructor` is a legal workspace member name and an illegal record key. The decision still
    // has to be recordable, or the finding recurs for ever with no answer.
    const commands = commandsFor({
      name: 'constructor',
      path: 'packages/c',
      status: 'unregistered',
    });

    expect(commands['register']).toBeUndefined();
    expect(commands['decline']).toContain('--decline');
  });

  it('offers nothing for a path the configuration cannot hold', () => {
    expect.hasAssertions();

    expect(
      commandsFor({ name: '@acme/ok', path: 'packages/100%', status: 'unregistered' }),
    ).toStrictEqual({});
  });
});

describe('a finding with nothing to offer', () => {
  it('offers nothing for a name declared at several paths', () => {
    expect.hasAssertions();

    // No single directory, so there is no path to put in a command — which is why the human line
    // names the candidates and stops.
    const issue: StructureIssue = {
      candidates: ['packages/a', 'packages/b'],
      name: '@acme/twice',
      status: 'unregistered',
    };

    expect(commandsFor(issue)).toStrictEqual({});
  });
});

describe('what a finding about a configured entry can offer', () => {
  it('offers the path edit for a relocation', () => {
    expect.hasAssertions();
    const issue: StructureIssue = {
      configured_path: 'packages/old',
      name: '@acme/moved',
      path: 'packages/new',
      status: 'relocated',
    };

    expect(commandsFor(issue)['repoint']).toContain("'path' 'packages/new'");
  });

  it('offers nothing for a relocation to a path the configuration cannot hold', () => {
    expect.hasAssertions();
    const issue: StructureIssue = {
      configured_path: 'packages/old',
      name: '@acme/moved',
      path: 'packages/100%',
      status: 'relocated',
    };

    expect(commandsFor(issue)).toStrictEqual({});
  });

  it('offers the removal for a package gone from the workspaces', () => {
    expect.hasAssertions();
    const issue: StructureIssue = {
      configured_path: 'packages/gone',
      name: '@acme/gone',
      status: 'missing',
    };

    expect(commandsFor(issue)['unregister']).toContain('--remove');
  });

  it.each([['ambiguous'], ['unverifiable']] as const)(
    'offers nothing for a status that is not a repair: %s',
    (status) => {
      expect.hasAssertions();

      expect(commandsFor({ name: '@acme/x', path: 'packages/x', status })).toStrictEqual({});
    },
  );
});
