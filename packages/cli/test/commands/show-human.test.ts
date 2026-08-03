import { describe, expect, it } from 'vitest';
import type { ShowData } from '../../src/commands/show.ts';
import { showHuman } from '../../src/commands/show.ts';
import { zRefKey } from '@kaisers-io/refs-core';

// Unit tests for `showHuman`, split into its own file (rather than piled onto `show.test.ts`) purely
// to keep both under the repo's 300-line oxlint cap, the same reason `show-payload.test.ts` exists.
// `now` is a fixed constant here (unlike the end-to-end tests in `show.test.ts`), so `just now` is
// safe to exercise only through the default `state: {}` -> `synced: never` path.

const NOW = Date.parse('2026-08-03T12:00:00.000Z');
const SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MINUTE = SECONDS_PER_MINUTE * SECOND;
const HOUR = MINUTES_PER_HOUR * MINUTE;
const THREE_HOURS = 3;

const showDataFor = (overrides: Partial<ShowData>): ShowData => ({
  default_branch: 'main',
  description: 'TypeScript-first schema validation',
  key: zRefKey.parse('github.com/colinhacks/zod'),
  local_path: '/home/refs/sources/github.com/colinhacks/zod',
  missing: false,
  packages_count: 0,
  stale: false,
  state: {},
  tag_format: 'v{version}',
  url: 'https://github.com/colinhacks/zod',
  ...overrides,
});

describe('refs show: showHuman renders every field as a key: value line', () => {
  it('prints every field on its own key: value line', () => {
    expect.hasAssertions();
    const data = showDataFor({
      stale: true,
      state: { last_fetched_at: new Date(NOW - THREE_HOURS * HOUR).toISOString() },
    });
    expect(showHuman(data, NOW)).toStrictEqual([
      'ref: github.com/colinhacks/zod',
      'description: TypeScript-first schema validation',
      'url: https://github.com/colinhacks/zod',
      'path: /home/refs/sources/github.com/colinhacks/zod',
      'synced: 3 hours ago',
      'status: stale',
    ]);
  });

  it('puts sample tags last, after the state lines', () => {
    expect.hasAssertions();
    const data = showDataFor({ sample_tags: ['v4.1.5', 'v4.1.4'] });
    expect(showHuman(data, NOW)).toStrictEqual([
      'ref: github.com/colinhacks/zod',
      'description: TypeScript-first schema validation',
      'url: https://github.com/colinhacks/zod',
      'path: /home/refs/sources/github.com/colinhacks/zod',
      'synced: never',
      'tags: v4.1.5, v4.1.4',
    ]);
  });

  it('reports a deleted checkout', () => {
    expect.hasAssertions();
    const data = showDataFor({ missing: true });
    expect(showHuman(data, NOW)).toContain('missing: checkout not found — run: refs sync');
  });

  it('omits the tags line when the probe found none', () => {
    expect.hasAssertions();
    const data = showDataFor({ sample_tags: [] });
    expect(showHuman(data, NOW).some((line) => line.startsWith('tags:'))).toBe(false);
  });
});
