import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { skillCheckOf, skillSource, writeSkillIn } from '../helpers/doctor-skill-support.ts';
import { join } from 'node:path';
import { withTempHome } from '../helpers/add-support.ts';

// The skill installed as a Codex plugin (`codex plugin add refs@kaisers-io`, docs/install.md). Codex
// copies the plugin into `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/` and records
// `[plugins."refs@kaisers-io"] enabled = true` in its config.toml; it loads the `local` version if
// there is one, else the highest (openai/codex, core-plugin-common/src/installed.rs). Without this
// the check reported a plugin-only install as missing, and named the wrong way to update it.

const CLI = '0.18.2';
const ENABLED = '[plugins."refs@kaisers-io"]\nenabled = true\n';

const cacheOf = (codexHome: string): string =>
  join(codexHome, 'plugins', 'cache', 'kaisers-io', 'refs');

/** A Codex home with `config` and the plugin's skill cached under each `version`. */
const codexHomeWith = async (
  codexHome: string,
  config: string,
  versions: Record<string, string>,
): Promise<void> => {
  await mkdir(codexHome, { recursive: true });
  await writeFile(join(codexHome, 'config.toml'), config);
  await Promise.all(
    Object.entries(versions).map(([version, cliVersion]) =>
      writeSkillIn(join(cacheOf(codexHome), version), skillSource(cliVersion)),
    ),
  );
};

describe('doctor: the skill installed as an enabled Codex plugin', () => {
  it('is found and compared like any other copy', async () => {
    expect.hasAssertions();
    await withTempHome(async (home) => {
      await codexHomeWith(join(home, '.codex'), ENABLED, { [CLI]: CLI });
      await expect(skillCheckOf(home, CLI)).resolves.toStrictEqual({
        detail: `Codex plugin refs@kaisers-io: the refs skill is installed and matches this CLI (${CLI})`,
        name: 'skill',
        status: 'ok',
      });
    });
  });

  it('names the plugin update, not the skills installer, when it is stale', async () => {
    expect.hasAssertions();
    await withTempHome(async (home) => {
      await codexHomeWith(join(home, '.codex'), ENABLED, { '0.17.0': '0.17.0' });
      const result = await skillCheckOf(home, CLI);
      expect(result.status).toBe('warn');
      expect(result.detail).toContain(
        'update the skill: codex plugin marketplace upgrade kaisers-io',
      );
      expect(result.detail).not.toContain('npx skills add');
    });
  });

  it('reads the version Codex loads: the highest, and `local` over any release', async () => {
    expect.hasAssertions();
    await withTempHome(async (home) => {
      const codexHome = join(home, 'codex-a');
      await codexHomeWith(codexHome, ENABLED, { '0.9.0': '0.9.0', [CLI]: CLI });
      const highest = await skillCheckOf(home, CLI, { env: { CODEX_HOME: codexHome } });
      expect(highest.status).toBe('ok');
      await codexHomeWith(codexHome, ENABLED, { local: '0.9.0' });
      const local = await skillCheckOf(home, CLI, { env: { CODEX_HOME: codexHome } });
      expect(local.status).toBe('warn');
    });
  });
});

describe('doctor: a Codex plugin cache that is not an install', () => {
  it.each([
    ['no plugins table', ''],
    ['the plugin disabled', '[plugins."refs@kaisers-io"]\nenabled = false\n'],
    ['another marketplace enabled', '[plugins."refs@someone-else"]\nenabled = true\n'],
    ['a config.toml that does not parse', '[plugins\nenabled = '],
  ])('is not counted with %s', async (_label, config) => {
    expect.hasAssertions();
    await withTempHome(async (home) => {
      await codexHomeWith(join(home, '.codex'), config, { [CLI]: CLI });
      const result = await skillCheckOf(home, CLI);
      expect(result.status).toBe('warn');
      expect(result.detail).toMatch(/^refs skill not found/u);
    });
  });
});

// Doctor is not the only place that names the fix: the skill's own version check (SKILL.md §1)
// prints one when it finds itself behind. Loaded as `refs:refs`, `npx skills add` would install a
// second, standalone copy beside the plugin instead of updating it.
describe('the skill naming its own update', () => {
  it.each(['skills/refs/SKILL.md', 'codex-plugin/skills/refs/SKILL.md'])(
    '%s names the plugin update doctor names',
    async (file) => {
      expect.hasAssertions();
      const text = await readFile(new URL(`../../../../${file}`, import.meta.url), 'utf8');
      expect(text.replaceAll(/\s+/gu, ' ')).toContain(
        '`refs:refs`, the skill updates with `codex plugin marketplace upgrade kaisers-io`',
      );
    },
  );
});
