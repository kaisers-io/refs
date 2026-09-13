import { describe, expect, it } from 'vitest';
import type { StructureIssue } from '../../src/commands/drift-report.ts';
import { driftLines } from '../../src/commands/drift-lines.ts';

// How discovery candidates read when a repository declares far more packages than a ref tracks.
//
// Grouped by the directory they sit under, structurally: a repository's fixtures are packages by
// every rule the resolvers apply, and refs does not get to label them. The directory says the
// same thing without a guess, and it is the repository's own layout that supplies it.

const KEY = 'github.com/acme/alpha';
const LAST = -1;

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

describe('more directories than the line holds', () => {
  it('counts the hidden directories AND the packages in them', () => {
    expect.hasAssertions();
    const DIRS = 12;
    const PER_DIR = 3;
    const CAP = 10;
    const candidates = Array.from({ length: DIRS }, (_unused, index) =>
      under(`top${index}`, PER_DIR),
    ).flat();

    const lines = driftLines({ discovery: candidates, status: 'ok' }, KEY);

    // A hidden GROUP is not a hidden finding: one of them can stand for any number of packages,
    // so the overflow has to name both units or the count misleads.
    expect(lines).toHaveLength(CAP + 1);
    expect(lines.at(LAST)).toContain(
      `${(DIRS - CAP) * PER_DIR} more unregistered package(s) in ${DIRS - CAP} director(ies)`,
    );
  });

  it('points at the report that actually has them', () => {
    expect.hasAssertions();
    const DIRS = 12;
    const PER_DIR = 3;
    const candidates = Array.from({ length: DIRS }, (_unused, index) =>
      under(`top${index}`, PER_DIR),
    ).flat();

    const lines = driftLines({ discovery: candidates, status: 'ok' }, KEY);

    // "Act on the ones above" is the instruction for repairs. A grouped count carries no package
    // name and no command, so there is nothing above to act on.
    expect(lines.at(LAST)).toContain("'refs doctor --json'");
    expect(lines.at(LAST)).not.toContain('act on the ones above');
  });
});

describe('overflow where the groups are small', () => {
  it('counts directories, not the lines they printed', () => {
    expect.hasAssertions();
    const DIRS = 6;
    const PER_DIR = 2;
    const CAP = 10;
    const candidates = Array.from({ length: DIRS }, (_unused, index) =>
      under(`top${index}`, PER_DIR),
    ).flat();

    const lines = driftLines({ discovery: candidates, status: 'ok' }, KEY);

    // Six directories of two print twelve lines, so two are held back — and both belong to the
    // same directory. Counting lines would report two directories where there is one.
    expect(lines).toHaveLength(CAP + 1);
    expect(lines.at(LAST)).toContain('2 more unregistered package(s) in 1 director(ies)');
  });
});

describe('a name declared in more than one place', () => {
  it('keeps its own line, naming every path', () => {
    expect.hasAssertions();
    const MANY = 5;
    const AMBIGUOUS_PLUS_GROUP = 2;

    const lines = driftLines(
      {
        discovery: [
          { candidates: ['packages/a', 'tools/a'], name: '@acme/a', status: 'unregistered' },
          ...under('packages', MANY),
        ],
        status: 'ok',
      },
      KEY,
    );

    // Folding it into `packages: 6` would drop `tools/a` — and the ambiguity with it, which is
    // the whole of that finding.
    expect(lines[0]).toContain('packages/a, tools/a');
    expect(lines).toHaveLength(AMBIGUOUS_PLUS_GROUP);
  });
});

describe('several names each declared in more than one place', () => {
  it('keeps every one of them on its own line', () => {
    expect.hasAssertions();
    const AMBIGUOUS = 4;
    const candidates = Array.from({ length: AMBIGUOUS }, (_unused, index) => ({
      candidates: [`packages/a${index}`, `tools/a${index}`],
      name: `@acme/a${index}`,
      status: 'unregistered' as const,
    }));

    const lines = driftLines({ discovery: candidates, status: 'ok' }, KEY);

    // Enough of them to pass the grouping threshold. Grouped, they would collapse into one
    // directory name and every second location would be gone.
    expect(lines).toHaveLength(AMBIGUOUS);
    expect(lines[0]).toContain('packages/a0, tools/a0');
  });
});

describe('overflow where the hidden candidates have no single directory', () => {
  it('counts the packages and claims no directories', () => {
    expect.hasAssertions();
    const AMBIGUOUS = 12;
    const CAP = 10;
    const candidates = Array.from({ length: AMBIGUOUS }, (_unused, index) => ({
      candidates: [`packages/a${index}`, `tools/a${index}`],
      name: `@acme/a${index}`,
      status: 'unregistered' as const,
    }));

    const lines = driftLines({ discovery: candidates, status: 'ok' }, KEY);

    // Each of these spans two directory trees. Naming one number for them would be a count that
    // is not true of anything.
    expect(lines.at(LAST)).toContain(`${AMBIGUOUS - CAP} more unregistered package(s) —`);
    expect(lines.at(LAST)).not.toContain('director(ies)');
  });
});
