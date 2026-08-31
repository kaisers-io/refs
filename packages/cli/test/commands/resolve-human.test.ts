import { describe, expect, it } from 'vitest';
import { resolveHuman } from '../../src/commands/resolve.ts';

// Unit tests for `resolveHuman`, split into its own file (rather than piled onto
// `resolve.test.ts`) purely to keep both under the repo's 300-line oxlint cap — the same reason
// `show-human.test.ts` exists. `now` is a fixed constant here, unlike the end-to-end tests in
// `resolve.test.ts`, which must never assert `just now` against the real clock.

const NOW = Date.parse('2026-08-03T12:00:00.000Z');
const SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MINUTE = SECONDS_PER_MINUTE * SECOND;
const HOUR = MINUTES_PER_HOUR * MINUTE;
const THREE_HOURS = 3;

describe('refs resolve: resolveHuman labels the bare key line and renames local_path to path', () => {
  it('renders ref/path/synced/status lines', () => {
    expect.hasAssertions();
    expect(
      resolveHuman(
        {
          checkout: { status: 'managed' },
          key: 'github.com/colinhacks/zod',
          last_fetched_at: new Date(NOW - THREE_HOURS * HOUR).toISOString(),
          local_path: '/home/refs/sources/github.com/colinhacks/zod',
          missing: false,
          // eslint-disable-next-line unicorn/no-null -- ResolveData's package field is a cross-process JSON contract requiring null, not undefined, for "no package match".
          package: null,
          stale: true,
        },
        NOW,
      ),
    ).toStrictEqual([
      'ref: github.com/colinhacks/zod',
      'path: /home/refs/sources/github.com/colinhacks/zod',
      'synced: 3 hours ago',
      'status: stale',
    ]);
  });
});

describe('refs resolve: resolveHuman gives the package path its own key, after the ref state', () => {
  it('appends package/package path lines', () => {
    expect.hasAssertions();
    expect(
      resolveHuman(
        {
          checkout: { status: 'managed' },
          key: 'github.com/colinhacks/zod',
          local_path: '/home/refs/sources/github.com/colinhacks/zod',
          missing: false,
          package: {
            local_path: '/home/refs/sources/github.com/colinhacks/zod/packages/zod',
            name: 'zod',
            path: 'packages/zod',
            status: 'verified',
          },
          stale: false,
        },
        NOW,
      ),
    ).toStrictEqual([
      'ref: github.com/colinhacks/zod',
      'path: /home/refs/sources/github.com/colinhacks/zod',
      'synced: never',
      'package: zod',
      'package path: /home/refs/sources/github.com/colinhacks/zod/packages/zod',
    ]);
  });
});
