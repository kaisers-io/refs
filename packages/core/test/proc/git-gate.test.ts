import { describe, expect, it } from 'vitest';
import { configEnvKey } from '../../src/proc/git-gate.ts';

// The key a runner caches its git gate under: it has to change with every variable that changes
// which configuration git reads, and stay put for everything else.

const BASE = { GIT_CONFIG_GLOBAL: '/u/gitconfig', HOME: '/u', PATH: '/usr/bin' };

describe('the git configuration environment key', () => {
  it('changes with the configuration files git reads', () => {
    expect.hasAssertions();
    const base = configEnvKey(BASE);
    expect(configEnvKey({ ...BASE, GIT_CONFIG_GLOBAL: '/v/gitconfig' })).not.toBe(base);
    expect(configEnvKey({ ...BASE, XDG_CONFIG_HOME: '/u/.cfg' })).not.toBe(base);
    expect(configEnvKey({ ...BASE, PATH: '/opt/git/bin' })).not.toBe(base);
    expect(configEnvKey({ ...BASE, GIT_CONFIG_PARAMETERS: "'hook.x.command'='y'" })).not.toBe(base);
  });

  it('changes with each counted GIT_CONFIG_KEY_<n>/GIT_CONFIG_VALUE_<n> pair', () => {
    expect.hasAssertions();
    const counted = { ...BASE, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'hook.a.command' };
    expect(configEnvKey({ ...counted, GIT_CONFIG_VALUE_0: 'x' })).not.toBe(
      configEnvKey({ ...counted, GIT_CONFIG_VALUE_0: 'y' }),
    );
    expect(configEnvKey({ ...counted, GIT_CONFIG_KEY_1: 'hook.b.command' })).toBe(
      configEnvKey(counted),
    );
  });

  it('ignores variables git does not read its configuration from', () => {
    expect.hasAssertions();
    expect(configEnvKey({ ...BASE, EDITOR: 'vi', GIT_CONFIG_COUNT: 'many' })).toBe(
      configEnvKey({ ...BASE, GIT_CONFIG_COUNT: 'many' }),
    );
  });
});
