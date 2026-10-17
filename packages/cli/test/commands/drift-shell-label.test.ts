import { describe, expect, it } from 'vitest';
import type { StructureIssue } from '../../src/commands/drift-report.ts';
import { driftLines } from '../../src/commands/drift-lines.ts';

// Every command refs prints for a drift finding is POSIX-quoted (`'\''` for an embedded quote),
// which PowerShell and cmd.exe parse differently. So each one says which shell it is for, right
// where it starts, and a line that prints no command says nothing about shells.

const KEY = 'github.com/acme/toolkit';
const LABEL = '(POSIX sh / Git Bash';
const lineFor = (issue: StructureIssue): string =>
  driftLines({ packages: [issue], status: 'drift' }, KEY).join('\n');

const commandLeadIns = (line: string): string[] =>
  [...line.matchAll(/(?<lead>[^.:]*): refs edit /gu)].map((match) => match.groups?.['lead'] ?? '');

describe('drift findings and the shell their commands are for', () => {
  it.each<[string, StructureIssue]>([
    ['relocated', { configured_path: 'old', name: '@acme/pkg', path: 'new', status: 'relocated' }],
    ['missing', { configured_path: 'old', name: '@acme/pkg', status: 'missing' }],
    ['unregistered', { name: "@acme/o'brien", path: 'packages/a b', status: 'unregistered' }],
  ])('labels every command of a %s finding', (_status, issue) => {
    expect.hasAssertions();
    const leads = commandLeadIns(lineFor(issue));
    expect(leads.length).toBeGreaterThan(0);
    expect(leads.filter((lead) => !lead.includes(LABEL))).toStrictEqual([]);
  });

  it('labels the decline-only suggestion for a name the packages table cannot hold', () => {
    expect.hasAssertions();
    // `constructor` can be declined but not registered (drift-commands.ts).
    const leads = commandLeadIns(
      lineFor({ name: 'constructor', path: 'pkg', status: 'unregistered' }),
    );
    expect(leads).toHaveLength(1);
    expect(leads.filter((lead) => !lead.includes(LABEL))).toStrictEqual([]);
  });

  it('names no shell when there is nothing to run', () => {
    expect.hasAssertions();
    expect(driftLines({ status: 'ok' }, KEY)).toStrictEqual([]);
  });
});
