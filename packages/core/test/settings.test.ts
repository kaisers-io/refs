import { describe, expect, it } from 'vitest';
import { zRefEntry, zSettings } from '../src/schemas/config.ts';
import { resolveSetting } from '../src/settings.ts';

describe('resolveSetting behavior', () => {
  const settings = zSettings.parse({ clone_mode: 'full' });
  const ref = zRefEntry.parse({
    clone_mode: 'blobless',
    default_branch: 'main',
    description: 'x',
    tag_format: '{version}',
    url: 'https://github.com/a/b',
  });

  it('prefers ref override, then global, for every key', () => {
    expect.hasAssertions();
    expect(resolveSetting('clone_mode', ref, settings)).toBe('blobless');
    expect(resolveSetting('clone_mode', undefined, settings)).toBe('full');
    // Global default
    expect(resolveSetting('sync_ttl', ref, settings)).toBe('1h');
  });
});
