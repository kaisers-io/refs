import { describe, expect, it } from 'vitest';
import { formatSince, statusLines } from '../../src/commands/ref-status.ts';

// A fixed clock so every expectation below is a pure function of its input.
const NOW = Date.parse('2026-08-03T12:00:00.000Z');
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

const SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_YEAR = 365;
const MINUTE = SECONDS_PER_MINUTE * SECOND;
const HOUR = MINUTES_PER_HOUR * MINUTE;
const DAY = HOURS_PER_DAY * HOUR;
const YEAR = DAYS_PER_YEAR * DAY;

// Durations that don't line up with a clean unit boundary, named for what they exercise rather
// than left as bare literals.
const JUST_UNDER_A_MINUTE_S = 59;
const TWO_MINUTES = 2;
const PAST_THE_HOUR_MIN = 119;
const JUST_UNDER_A_DAY_HOURS = 23;
const JUST_UNDER_A_YEAR_DAYS = 364;
const THREE_YEARS = 3;
const TWELVE_MINUTES = 12;
const THREE_HOURS = 3;
const TWO_DAYS = 2;

describe('formatSince: never-fetched, unparseable, and future timestamps', () => {
  it('reports a never-fetched ref as never', () => {
    expect.hasAssertions();
    expect(formatSince(undefined, NOW)).toBe('never');
  });

  it('reports an unparseable timestamp as never rather than NaN', () => {
    expect.hasAssertions();
    expect(formatSince('not-a-date', NOW)).toBe('never');
  });

  it('clamps a future timestamp to just now instead of a negative duration', () => {
    expect.hasAssertions();
    expect(formatSince(new Date(NOW + HOUR).toISOString(), NOW)).toBe('just now');
  });

  it('reports anything under a minute as just now', () => {
    expect.hasAssertions();
    expect(formatSince(ago(JUST_UNDER_A_MINUTE_S * SECOND), NOW)).toBe('just now');
  });
});

describe('formatSince: unit boundaries and rounding', () => {
  it('switches to minutes at exactly one minute, in the singular', () => {
    expect.hasAssertions();
    expect(formatSince(ago(MINUTE), NOW)).toBe('1 minute ago');
  });

  it('pluralizes minutes', () => {
    expect.hasAssertions();
    expect(formatSince(ago(TWO_MINUTES * MINUTE), NOW)).toBe('2 minutes ago');
  });

  it('switches to hours at exactly 60 minutes', () => {
    expect.hasAssertions();
    expect(formatSince(ago(MINUTES_PER_HOUR * MINUTE), NOW)).toBe('1 hour ago');
  });

  it('rounds down rather than up at the hour boundary', () => {
    expect.hasAssertions();
    expect(formatSince(ago(PAST_THE_HOUR_MIN * MINUTE), NOW)).toBe('1 hour ago');
  });

  it('switches to days at exactly 24 hours', () => {
    expect.hasAssertions();
    expect(formatSince(ago(DAY), NOW)).toBe('1 day ago');
  });

  it('reports 23 hours as hours, not days', () => {
    expect.hasAssertions();
    expect(formatSince(ago(JUST_UNDER_A_DAY_HOURS * HOUR), NOW)).toBe('23 hours ago');
  });

  it('reports 364 days as days, not years', () => {
    expect.hasAssertions();
    expect(formatSince(ago(JUST_UNDER_A_YEAR_DAYS * DAY), NOW)).toBe('364 days ago');
  });

  it('switches to years at 365 days', () => {
    expect.hasAssertions();
    expect(formatSince(ago(YEAR), NOW)).toBe('1 year ago');
  });

  it('pluralizes years for very old checkouts', () => {
    expect.hasAssertions();
    expect(formatSince(ago(THREE_YEARS * YEAR), NOW)).toBe('3 years ago');
  });
});

describe('statusLines: the synced/status/missing summary lines', () => {
  it('prints only synced for a fresh, present checkout', () => {
    expect.hasAssertions();
    const lastFetchedAt = ago(TWELVE_MINUTES * MINUTE);
    expect(
      statusLines({ lastFetchedAt, missing: false, now: NOW, stale: false }),
    ).toStrictEqual(['synced: 12 minutes ago']);
  });

  it('adds a status line when the ref is past its ttl', () => {
    expect.hasAssertions();
    const lastFetchedAt = ago(THREE_HOURS * HOUR);
    expect(statusLines({ lastFetchedAt, missing: false, now: NOW, stale: true })).toStrictEqual([
      'synced: 3 hours ago',
      'status: stale',
    ]);
  });

  it('omits the redundant status line when the ref was never fetched', () => {
    expect.hasAssertions();
    expect(
      statusLines({ lastFetchedAt: undefined, missing: false, now: NOW, stale: true }),
    ).toStrictEqual(['synced: never']);
  });

  it('omits it for an unparseable timestamp too, which also renders as never', () => {
    expect.hasAssertions();
    expect(
      statusLines({ lastFetchedAt: 'not-a-date', missing: false, now: NOW, stale: true }),
    ).toStrictEqual(['synced: never']);
  });

  it('reports a deleted checkout that is not yet past its ttl', () => {
    expect.hasAssertions();
    expect(
      statusLines({ lastFetchedAt: ago(MINUTE), missing: true, now: NOW, stale: false }),
    ).toStrictEqual(['synced: 1 minute ago', 'missing: checkout not found — run: refs sync']);
  });

  it('reports both status and missing when both apply', () => {
    expect.hasAssertions();
    const lastFetchedAt = ago(TWO_DAYS * DAY);
    expect(statusLines({ lastFetchedAt, missing: true, now: NOW, stale: true })).toStrictEqual([
      'synced: 2 days ago',
      'status: stale',
      'missing: checkout not found — run: refs sync',
    ]);
  });
});
