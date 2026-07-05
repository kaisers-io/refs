import { describe, expect, it } from 'vitest';
import {
  durationToMs,
  zCloneMode,
  zDuration,
  zGitTransport,
  zPackagePath,
  zRefKey,
  zTagFormat,
} from '../../src/schemas/primitives.ts';

const MS_PER_MINUTE = 60_000;
const MINUTES_30 = 30;
const DURATION_30_MINUTES_MS = MINUTES_30 * MS_PER_MINUTE;
const MS_PER_HOUR = 3_600_000;
const DURATION_1_HOUR_MS = MS_PER_HOUR;
const MS_PER_DAY = 86_400_000;
const DAYS_2 = 2;
const DURATION_2_DAYS_MS = DAYS_2 * MS_PER_DAY;

describe('ref key validation', () => {
  it('accepts host/owner/repo and deeper group paths', () => {
    expect.hasAssertions();
    expect(zRefKey.parse('github.com/vercel/next.js')).toBe('github.com/vercel/next.js');
    expect(zRefKey.parse('gitlab.com/group/sub/repo')).toBe('gitlab.com/group/sub/repo');
    expect(zRefKey.parse('git.example.io_2222/team/repo')).toBe('git.example.io_2222/team/repo');
  });

  it('accepts valid edge-case ports', () => {
    expect.hasAssertions();
    expect(zRefKey.parse('github.com_1/a/b')).toBe('github.com_1/a/b');
    expect(zRefKey.parse('github.com_65535/a/b')).toBe('github.com_65535/a/b');
  });

  it.each([
    ['github.com', 'Fewer than 2 path segments'],
    ['github.com//repo', 'Empty segment'],
    ['github.com/./repo', 'Dot segment'],
    ['github.com/../repo', 'Double dot segment'],
    ['/github.com/a/b', 'Leading slash'],
    ['github.com/a/b/', 'Trailing slash'],
    ['github.com/a/%2e%2e', 'Encoded traversal'],
    ['github.com/a:b/c', 'Colon in segment'],
    ['GitHub.com/a/b', 'Host must be lowercase'],
    ['github..com/a/b', 'Empty DNS label'],
    ['a.-b.com/a/b', 'Label starts with hyphen'],
    ['a-.b.com/a/b', 'Label ends with hyphen'],
    ['github.com_0/a/b', 'Port 0 invalid'],
    ['github.com_65536/a/b', 'Port 65536 out of range'],
    ['github.com_99999/a/b', 'Port 99999 out of range'],
  ])('rejects %s (%s)', (bad) => {
    expect.hasAssertions();
    expect(zRefKey.safeParse(bad).success).toBe(false);
  });
});

describe('duration validation', () => {
  it('parses m/h/d and converts to ms', () => {
    expect.hasAssertions();
    expect(durationToMs(zDuration.parse('30m'))).toBe(DURATION_30_MINUTES_MS);
    expect(durationToMs(zDuration.parse('1h'))).toBe(DURATION_1_HOUR_MS);
    expect(durationToMs(zDuration.parse('2d'))).toBe(DURATION_2_DAYS_MS);
  });

  it('accepts max 4-digit amounts and rejects 5+ digits', () => {
    expect.hasAssertions();
    expect(zDuration.safeParse('9999d').success).toBe(true);
    expect(zDuration.safeParse('10000d').success).toBe(false);
  });

  it.each(['1', 'h', '1w', '-1h', '1.5h', ''])('rejects %s', (bad) => {
    expect.hasAssertions();
    expect(zDuration.safeParse(bad).success).toBe(false);
  });
});

describe('enums and tag format validation', () => {
  it('validates clone mode, transport, tag format', () => {
    expect.hasAssertions();
    expect(zCloneMode.parse('blobless')).toBe('blobless');
    expect(zGitTransport.safeParse('http').success).toBe(false);
    expect(zTagFormat.parse('v{version}')).toBe('v{version}');
    expect(zTagFormat.parse('release/v{version}')).toBe('release/v{version}');
    // No {version} placeholder
    expect(zTagFormat.safeParse('v1.2.3').success).toBe(false);
  });
});

describe('package path validation', () => {
  it('accepts "." and normalized relative paths, rejects traversal/absolute', () => {
    expect.hasAssertions();
    expect(zPackagePath.parse('.')).toBe('.');
    expect(zPackagePath.parse('packages/next')).toBe('packages/next');
    for (const bad of ['../x', 'a/../../b', '/abs', 'a//b', 'a/./b', 'a/..']) {
      expect(zPackagePath.safeParse(bad).success).toBe(false);
    }
  });
});
