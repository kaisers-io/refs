import { describe, expect, it } from 'vitest';
import { resolveHome, zRefKey } from '@kaisers-io/refs-core';
import type { CliContext } from '../../src/context.ts';
import { runEditSettings } from '../../src/commands/edit-settings.ts';
import { seedConfig } from '../helpers/ref-fixtures.ts';
import { testContext } from '../helpers/context.ts';
import { withTempHome } from '../helpers/add-support.ts';

// Edge coverage for `refs edit settings <key> <value>` beyond `edit-settings-guard.test.ts`'s
// single-collision cases: an unknown settings key must be a usage error listing every valid key
// (derived from `zSettings`' own shape), and MULTIPLE refs sharing the reserved `/settings`
// suffix must still produce a collision warning — `matchRefKey`'s ambiguity error means "several
// refs are shadowed", not "none are".

const settingsSuffixEntry = (host: string): Record<string, unknown> => ({
  default_branch: 'main',
  description: 'A ref whose key ends in the reserved settings suffix.',
  tag_format: 'v{version}',
  url: `https://${host}/acme/settings`,
});

const setupHome = async (homeDir: string, refs: Record<string, unknown>): Promise<CliContext> => {
  const { ctx } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  await seedConfig(resolveHome(ctx.env), refs);
  return ctx;
};

describe('edit settings: unknown key', () => {
  it('rejects with a usage error listing every valid setting', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const ctx = await setupHome(homeDir, {});
      await expect(runEditSettings(ctx, { key: 'nope', value: 'x' })).rejects.toThrow(
        "unknown setting 'nope' — valid settings: clone_mode, git_transport, sync_ttl",
      );
    });
  });
});

describe('edit settings: ambiguous settings-suffix collision', () => {
  it('warns when several refs match the reserved suffix, without naming a single one', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const ctx = await setupHome(homeDir, {
        [zRefKey.parse('one.example.com/acme/settings')]: settingsSuffixEntry('one.example.com'),
        [zRefKey.parse('two.example.com/acme/settings')]: settingsSuffixEntry('two.example.com'),
      });
      const result = await runEditSettings(ctx, { key: 'sync_ttl', value: '2h' });
      expect(result.data.new).toBe('2h');
      expect(result.warnings).toStrictEqual([
        expect.stringContaining('one of several matching refs'),
      ]);
    });
  });
});
