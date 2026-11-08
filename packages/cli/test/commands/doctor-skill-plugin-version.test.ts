import { describe, expect, it } from 'vitest';
import { activeCodexPluginVersionOf } from '../../src/commands/doctor-skill-plugin-version.ts';

// Which cached plugin directory Codex loads, for names that are not plain `x.y.z` versions. The
// doctor suite covers semver ordering and `local` through a real Codex home; these are the names
// that fall back to Codex's lexical ordering, and the ones Codex refuses as version segments.

describe('the Codex plugin version directory', () => {
  it('orders names that are not plain versions lexically, as Codex does', () => {
    expect.hasAssertions();

    // Known divergence, pinned so it stays deliberate: a prerelease against its release compares
    // as strings here, where Codex ranks the prerelease lower.
    expect(activeCodexPluginVersionOf(['1.0.0-rc.1', '1.0.0-rc.2', '1.0.0'])).toBe('1.0.0-rc.2');
    expect(activeCodexPluginVersionOf(['beta', 'alpha', 'nightly'])).toBe('nightly');
  });

  it('takes the same answer when a name is listed twice', () => {
    expect.hasAssertions();

    expect(activeCodexPluginVersionOf(['main', 'main', 'dev'])).toBe('main');
  });

  it('skips names Codex would not accept as a version segment', () => {
    expect.hasAssertions();

    // A space or a path component is not a version Codex can load from, however it sorts.
    expect(activeCodexPluginVersionOf(['1.0.0', 'z z', '..', '.'])).toBe('1.0.0');
    expect(activeCodexPluginVersionOf(['z z', '..'])).toBeUndefined();
  });
});
