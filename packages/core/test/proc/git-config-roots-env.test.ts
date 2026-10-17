import { describe, expect, it } from 'vitest';
import { configRootCandidates } from '../../src/proc/git-config-roots-env.ts';

describe('native Git configuration root environment', () => {
  it('uses both Git for Windows home fallback candidates', () => {
    expect.hasAssertions();
    expect(
      configRootCandidates(
        { HomeDrive: 'C:', HomePath: '/Users/synthetic', UserProfile: 'D:/Profile' },
        'win32',
      ),
    ).toStrictEqual([
      'C:/Users/synthetic/.gitconfig',
      'D:/Profile/.gitconfig',
      'C:/Users/synthetic/.config/git/config',
      'D:/Profile/.config/git/config',
    ]);
  });

  it('normalizes Windows key casing and honors explicit HOME', () => {
    expect.hasAssertions();
    expect(
      configRootCandidates(
        { UserProfile: 'D:/Unused', home: 'C:/Home', xdg_config_home: 'C:/Xdg' },
        'win32',
      ),
    ).toStrictEqual(['C:/Home/.gitconfig', 'C:/Xdg/git/config']);
    expect(
      configRootCandidates(
        { Git_Config_System: 'C:/system', git_config_global: 'C:/global', home: 'D:/Unused' },
        'win32',
      ),
    ).toStrictEqual(['C:/system', 'C:/global']);
  });

  it('rejects ambiguous Windows key casings instead of guessing which spawn will select', () => {
    expect.hasAssertions();
    expect(() => configRootCandidates({ HOME: 'C:/first', home: 'C:/second' }, 'win32')).toThrow(
      'cannot be safely inventoried',
    );
  });
});

describe('legacy Windows system configuration', () => {
  it('inventories the legacy Windows system root even with a global override', () => {
    expect.hasAssertions();
    expect(
      configRootCandidates(
        { GIT_CONFIG_GLOBAL: 'C:/global', ProgramData: 'C:/future-checkout' },
        'win32',
      ),
    ).toStrictEqual(['C:/global', 'C:/future-checkout/Git/config']);
    expect(configRootCandidates({ ProgramData: '' }, 'win32')).toStrictEqual(['/Git/config']);
    expect(
      configRootCandidates({ PROGRAMDATA: '/ignored', ProgramData: '/ignored' }, 'linux'),
    ).toStrictEqual([]);
  });
});

describe('posix root semantics', () => {
  it('keeps POSIX environment names case sensitive and does not invent a home', () => {
    expect.hasAssertions();
    expect(
      configRootCandidates({ USERPROFILE: '/ignored', home: '/ignored' }, 'linux'),
    ).toStrictEqual([]);
    expect(configRootCandidates({ HOME: '/home', XDG_CONFIG_HOME: '' }, 'linux')).toStrictEqual([
      '/home/.gitconfig',
      '/home/.config/git/config',
    ]);
  });

  it('preserves lexical symlink and parent-directory paths', () => {
    expect.hasAssertions();
    expect(configRootCandidates({ HOME: '/external/link/..' }, 'linux')).toStrictEqual([
      '/external/link/../.gitconfig',
      '/external/link/../.config/git/config',
    ]);
  });
});
