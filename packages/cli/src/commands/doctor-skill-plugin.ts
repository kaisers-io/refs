import { readFile, readdir } from 'node:fs/promises';
import type { CliContext } from '../context.ts';
import { comparePlainVersions } from '@kaisers-io/refs-core';
import { join } from 'node:path';
import { parse } from 'smol-toml';

// The refs skill installed as a Codex plugin (`codex plugin add refs@kaisers-io`, docs/install.md),
// for doctor's `skill` check. Where Codex keeps it, from openai/codex (core-plugins/src/store.rs,
// core-plugin-common/src/installed.rs, config/src/plugin_edit.rs):
//
// - `codex plugin add` records `[plugins."refs@kaisers-io"] enabled = true` in
//   `$CODEX_HOME/config.toml`. Only that counts as installed: a cache left behind after the plugin
//   was disabled or removed is not what Codex loads.
// - It copies the plugin to `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/`, and
//   loads the `local` version when there is one, otherwise the highest. Plain versions are ordered
//   numerically here; anything else by its name, which is Codex's own fallback (refs publishes
//   plain versions only).
//
// Read-only, like the rest of the check: one config file and one directory listing, nothing run.

const MARKETPLACE = 'kaisers-io';
const PLUGIN = 'refs';
const PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;
const LOCAL_VERSION = 'local';
const VERSION_SEGMENT = /^[\w.+-]+$/u;
const PLUGIN_UPDATE_HINT = `codex plugin marketplace upgrade ${MARKETPLACE}`;

type PluginCandidate = { display: string; label: string; path: string; skillUpdate: string };

const isTable = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `$CODEX_HOME` when set and not blank, else `<home>/.codex` — as the standalone Codex location. */
const codexHomeOf = (ctx: CliContext): { display: string; path: string } | undefined => {
  const override = ctx.env['CODEX_HOME']?.trim();
  if (override !== undefined && override.length > 0) {
    return { display: override, path: override };
  }
  return ctx.homedir.length > 0
    ? { display: '~/.codex', path: join(ctx.homedir, '.codex') }
    : undefined;
};

const isEnabled = async (codexHome: string): Promise<boolean> => {
  try {
    const config = parse(await readFile(join(codexHome, 'config.toml'), 'utf8'));
    const { plugins } = config;
    const entry = isTable(plugins) ? plugins[PLUGIN_ID] : undefined;
    return isTable(entry) && entry['enabled'] === true;
  } catch {
    // No config, or one that does not parse: Codex itself would load no plugin from it.
    return false;
  }
};

const byVersion = (left: string, right: string): number =>
  comparePlainVersions(left, right) ?? Number(left > right) - Number(left < right);

/** The version directory Codex loads from `root`, or `undefined` when there is none. */
const activeVersion = async (root: string): Promise<string | undefined> => {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const versions = entries
    .filter((entry) => entry.isDirectory() && VERSION_SEGMENT.test(entry.name))
    .map((entry) => entry.name)
    .filter((name) => name !== '.' && name !== '..');
  return versions.includes(LOCAL_VERSION) ? LOCAL_VERSION : versions.toSorted(byVersion).pop();
};

/** The enabled Codex plugin's skill as one more place to read, or nothing. */
const codexPluginCandidates = async (ctx: CliContext): Promise<PluginCandidate[]> => {
  const codexHome = codexHomeOf(ctx);
  if (codexHome === undefined || !(await isEnabled(codexHome.path))) {
    return [];
  }
  const root = join(codexHome.path, 'plugins', 'cache', MARKETPLACE, PLUGIN);
  const version = (await activeVersion(root)) ?? LOCAL_VERSION;
  return [
    {
      display: `${codexHome.display} (plugin ${PLUGIN_ID})`,
      label: `Codex plugin ${PLUGIN_ID}`,
      path: join(root, version, 'skills', 'refs', 'SKILL.md'),
      skillUpdate: PLUGIN_UPDATE_HINT,
    },
  ];
};

export { codexPluginCandidates };
