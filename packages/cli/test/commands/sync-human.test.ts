import { describe, expect, it } from 'vitest';
import type { SyncResultItem } from '../../src/commands/sync-core.ts';
import { syncHuman } from '../../src/commands/sync.ts';

// Unit tests for `syncHuman`, the summary-plus-per-ref renderer for `refs sync` — specifically
// how drift appears in it. Mirrors `list-human.test.ts`'s split: the CLI wiring and the probe
// itself are covered elsewhere (`sync-drift.test.ts`, `drift-probe.test.ts`); this file only
// covers the framing, because the framing is where a drifted ref could silently look clean.

const DRIFT_LINE_INDEX = 2;

const SUMMARY = 'Updated (1) / Fresh (0) / Cloned (0) / Restored (0) / Failed (0)';

const updated = (overrides: Partial<SyncResultItem>): SyncResultItem => ({
  key: 'github.com/acme/alpha',
  status: 'updated',
  ...overrides,
});

describe('syncHuman: a clean ref reads exactly as it always did', () => {
  it('prints the summary and one bare line per ref when nothing drifted', () => {
    expect.hasAssertions();

    const lines = syncHuman([updated({ structure: { status: 'ok' } })]);

    expect(lines).toStrictEqual([SUMMARY, '  github.com/acme/alpha']);
  });
});

describe('syncHuman: drift is indented under its own ref', () => {
  it('keeps the summary counts and the warning parenthesis untouched', () => {
    expect.hasAssertions();

    const lines = syncHuman([
      updated({
        structure: {
          packages: [{ configured_path: 'packages/b', name: '@acme/b', status: 'missing' }],
          status: 'drift',
        },
        warning: 'default branch renamed to trunk',
      }),
    ]);

    expect(lines[0]).toBe(SUMMARY);
    expect(lines[1]).toBe('  github.com/acme/alpha (default branch renamed to trunk)');
    expect(lines[DRIFT_LINE_INDEX]).toContain('    @acme/b:');
  });
});
