import { describe, expect, it } from 'vitest';
import type { StructureIssue } from '../../src/commands/drift-report.ts';
import { driftLines } from '../../src/commands/drift-lines.ts';

const KEY = 'github.com/acme/alpha';
const SHELL = 'POSIX sh / Git Bash';
const findings: StructureIssue[] = [
  { configured_path: 'old', name: '@acme/pkg', path: 'new', status: 'relocated' },
  { configured_path: 'old', name: '@acme/pkg', status: 'missing' },
];

describe('printed repair shell contract', () => {
  it.each(findings)('labels $status repairs with their required shell', (issue) => {
    expect.hasAssertions();
    const lines = driftLines({ packages: [issue], status: 'drift' }, KEY);
    expect(lines.join('\n')).toContain(SHELL);
    expect(lines.join('\n')).toContain('refs edit ');
  });

  it('labels registration and decline suggestions', () => {
    expect.hasAssertions();
    const lines = driftLines(
      { discovery: [{ name: '@acme/pkg', path: 'pkg', status: 'unregistered' }], status: 'ok' },
      KEY,
    );
    expect(lines.join('\n')).toContain(`To register it (${SHELL};`);
    expect(lines.join('\n')).toContain(`If it should not be (${SHELL}):`);
  });

  it('does not suggest a shell or command for a clean checkout', () => {
    expect.hasAssertions();
    expect(driftLines({ status: 'ok' }, KEY)).toStrictEqual([]);
  });
});
