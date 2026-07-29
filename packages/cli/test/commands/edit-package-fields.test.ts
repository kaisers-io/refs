import type { Config, RefEntry, RefsHome } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { readConfig, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { editPackageField } from '../../src/commands/edit-package.ts';
import { seedConfig } from '../helpers/ref-fixtures.ts';
import { withTempHome } from '../helpers/add-support.ts';

// Error-path coverage for `refs edit <ref> <field> <value> --package <name>`: an unknown package
// field must be a usage error that lists every valid field (derived from `zPackageEntry`'s own
// shape, so the message can never drift), and a value that fails the re-validation of the WHOLE
// package entry must be rejected without touching the config on disk. The happy path is covered
// by the edit e2e suite.

const REF_KEY = zRefKey.parse('example.com/acme/widget');
const PACKAGE_NAME = '@acme/widget';
const PACKAGE_DESCRIPTION = 'The widget package.';

const REF_ENTRY = {
  default_branch: 'main',
  description: 'A fixture ref.',
  packages: { [PACKAGE_NAME]: { description: PACKAGE_DESCRIPTION, path: 'packages/widget' } },
  tag_format: 'v{version}',
  url: 'https://example.com/acme/widget.git',
};

type EditFixture = {
  config: Config;
  entry: RefEntry;
  home: RefsHome;
};

const setupPackageRef = async (homeDir: string): Promise<EditFixture> => {
  const home = resolveHome({ REFS_HOME: homeDir });
  const config = await seedConfig(home, { [REF_KEY]: REF_ENTRY });
  const entry = config.refs[REF_KEY];
  if (entry === undefined) {
    throw new Error('test setup: seeded ref missing from config');
  }
  return { config, entry, home };
};

const editArgs = (
  fixture: EditFixture,
  field: string,
  value: string,
): Parameters<typeof editPackageField>[0] => ({
  config: fixture.config,
  entry: fixture.entry,
  field,
  home: fixture.home,
  key: REF_KEY,
  packageName: PACKAGE_NAME,
  value,
});

describe('edit package: field validation', () => {
  it('rejects an unknown package field, listing every valid field', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const fixture = await setupPackageRef(homeDir);
      await expect(editPackageField(editArgs(fixture, 'color', 'blue'))).rejects.toThrow(
        "unknown package field 'color' — valid fields: description, path, tag_format",
      );
    });
  });

  it('rejects a value failing whole-entry re-validation without touching the config', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const fixture = await setupPackageRef(homeDir);
      await expect(editPackageField(editArgs(fixture, 'description', ''))).rejects.toThrow(
        /description/u,
      );
      const config = await readConfig(fixture.home);
      expect(config.refs[REF_KEY]?.packages?.[PACKAGE_NAME]?.description).toBe(PACKAGE_DESCRIPTION);
    });
  });
});
