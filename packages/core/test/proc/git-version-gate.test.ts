import {
  GIT_2_54_REFUSAL,
  gitVersionRefusal,
  isVersionProbe,
} from '../../src/proc/git-version-gate.ts';
import { describe, expect, it } from 'vitest';

describe('the git release line refs refuses', () => {
  it.each([
    ['git version 2.54.0', GIT_2_54_REFUSAL],
    ['git version 2.54.1.windows.1\n', GIT_2_54_REFUSAL],
    ['git version 2.54', GIT_2_54_REFUSAL],
    ['git version 2.53.0', undefined],
    ['git version 2.55.0', undefined],
    ['git version 2.540.0', undefined],
    ['', undefined],
  ])('answers %j with the expected refusal', (output, refusal) => {
    expect.hasAssertions();
    expect(gitVersionRefusal(output)).toBe(refusal);
  });

  it('names the versions to install', () => {
    expect.hasAssertions();
    expect(GIT_2_54_REFUSAL).toContain('2.55 or newer');
  });

  it('exempts only the version probe itself', () => {
    expect.hasAssertions();
    expect(isVersionProbe(['--version'])).toBe(true);
    expect(isVersionProbe(['version'])).toBe(false);
    expect(isVersionProbe(['--version', 'x'])).toBe(false);
  });
});
