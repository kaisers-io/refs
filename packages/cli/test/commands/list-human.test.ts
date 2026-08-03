import { describe, expect, it } from 'vitest';
import type { ListItem } from '../../src/commands/list.ts';
import { listHuman } from '../../src/commands/list.ts';

// Unit tests for `listHuman`, the `ref:`/`description:`/synced-block renderer for `refs list`.
// Split out of `list.test.ts` (which covers data + CLI wiring) purely to keep both files under
// the repo's max-lines cap. `statusLines` itself (the `synced:`/`status:`/`missing:` lines) is
// exercised in `ref-status.test.ts`; these tests only cover the per-item framing around it and
// the blank-line separator between multiple refs.

const NOW = Date.parse('2026-08-03T12:00:00.000Z');
const SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MINUTE = SECONDS_PER_MINUTE * SECOND;
const HOUR = MINUTES_PER_HOUR * MINUTE;
const THREE_HOURS = 3;

const itemFor = (overrides: Partial<ListItem>): ListItem => ({
  clone_mode: 'blobless',
  description: 'TypeScript-first schema validation',
  key: 'github.com/colinhacks/zod',
  missing: false,
  packages_count: 0,
  stale: false,
  ...overrides,
});

describe('listHuman: per-ref key: value lines', () => {
  it('prints one key: value line per field', () => {
    expect.hasAssertions();
    const item = itemFor({ last_fetched_at: new Date(NOW - THREE_HOURS * HOUR).toISOString() });
    expect(listHuman([item], NOW)).toStrictEqual([
      'ref: github.com/colinhacks/zod',
      'description: TypeScript-first schema validation',
      'synced: 3 hours ago',
    ]);
  });

  it('appends status and missing lines when they apply', () => {
    expect.hasAssertions();
    const item = itemFor({
      last_fetched_at: new Date(NOW - THREE_HOURS * HOUR).toISOString(),
      missing: true,
      stale: true,
    });
    expect(listHuman([item], NOW)).toStrictEqual([
      'ref: github.com/colinhacks/zod',
      'description: TypeScript-first schema validation',
      'synced: 3 hours ago',
      'status: stale',
      'missing: checkout not found — run: refs sync',
    ]);
  });
});

describe('listHuman: multiple refs and the empty-config case', () => {
  it('separates multiple refs with a blank line, and adds none at the end', () => {
    expect.hasAssertions();
    const lines = listHuman(
      [itemFor({ key: 'github.com/a/one' }), itemFor({ key: 'github.com/b/two' })],
      NOW,
    );
    expect(lines).toStrictEqual([
      'ref: github.com/a/one',
      'description: TypeScript-first schema validation',
      'synced: never',
      '',
      'ref: github.com/b/two',
      'description: TypeScript-first schema validation',
      'synced: never',
    ]);
  });

  it('keeps its own wording for an empty config', () => {
    expect.hasAssertions();
    expect(listHuman([], NOW)).toStrictEqual(['no refs configured — run: refs add <source>']);
  });
});
