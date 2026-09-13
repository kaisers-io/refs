import { describe, expect, it } from 'vitest';
import type { StructureIssue } from '../../src/commands/drift-report.ts';
import { driftLines } from '../../src/commands/drift-lines.ts';

// How discovery candidates read when a repository declares far more packages than a ref tracks.
//
// Grouped by the directory they sit under, structurally: a repository's fixtures are packages by
// every rule the resolvers apply, and refs does not get to label them. The directory says the
// same thing without a guess, and it is the repository's own layout that supplies it.

const KEY = 'github.com/acme/alpha';

const under = (dir: string, count: number): StructureIssue[] =>
  Array.from({ length: count }, (_unused, index) => ({
    name: `@acme/${dir.replaceAll('/', '-')}-${index}`,
    path: `${dir}/pkg-${index}/inner`,
    status: 'unregistered' as const,
  }));

describe('discovery, grouped by where the candidates sit', () => {
  it('names the directory where the tree branches, not each leaf', () => {
    expect.hasAssertions();
    const MANY = 30;

    const lines = driftLines(
      { discovery: under('packages/test/fixtures', MANY), status: 'ok' },
      KEY,
    );

    // One fixture per directory is the shape that made this necessary: naming each of them is the
    // wall the grouping exists to avoid.
    expect(lines).toStrictEqual([
      `packages/test/fixtures: ${MANY} unregistered package(s) the configuration does not have`,
    ]);
  });

  it('keeps the per-package command where there are only a couple', () => {
    expect.hasAssertions();
    const FEW = 2;

    const lines = driftLines({ discovery: under('packages', FEW), status: 'ok' }, KEY);

    // These are the ones somebody may actually want to register, so they keep their commands.
    expect(lines).toHaveLength(FEW);
    expect(lines[0]).toContain('--create');
  });

  it('splits by top-level directory, which is where a repository puts the boundary', () => {
    expect.hasAssertions();
    const MANY = 20;

    const lines = driftLines(
      { discovery: [...under('examples', MANY), ...under('packages/test', MANY)], status: 'ok' },
      KEY,
    );

    expect(lines).toStrictEqual([
      `examples: ${MANY} unregistered package(s) the configuration does not have`,
      `packages/test: ${MANY} unregistered package(s) the configuration does not have`,
    ]);
  });
});
