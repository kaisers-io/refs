import { readFile, readdir } from 'node:fs/promises';
import type { CheckResult } from './doctor-types.ts';
import type { CliContext } from '../context.ts';
import type { SkillCandidate } from './doctor-skill-locations.ts';
import { comparePlainVersions } from '@kaisers-io/refs-core';
import { join } from 'node:path';
import { parse } from 'smol-toml';

const PLUGIN_UPDATE_HINT =
  'refresh the refs marketplace (rebuild a local package, or run codex plugin marketplace upgrade refs for a Git source), then codex plugin add refs@refs';
const PLUGIN_ID = 'refs@refs';
const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
type PluginCandidates = { candidates: SkillCandidate[]; warning?: CheckResult };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const pluginEnabled = async (home: string): Promise<boolean> => {
  const config = parse(await readFile(join(home, 'config.toml'), 'utf8'));
  const { plugins } = config;
  const plugin = isObject(plugins) ? plugins[PLUGIN_ID] : undefined;
  return isObject(plugin) && plugin['enabled'] === true;
};

// Codex 0.159.2 selects `local`, otherwise the greatest version directory. A normal add removes
// old versions. Compare plain releases exactly; with several non-plain versions do not guess
// SemVer precedence or report a stale cache as the active skill. This is a best-effort diagnostic,
// not the skill's capability gate. See core-plugin-common/src/installed.rs in openai/codex.
const activeVersion = async (root: string): Promise<string | undefined> => {
  const entries = await readdir(root, { withFileTypes: true });
  const versions = entries
    .filter((entry) => entry.isDirectory() && /^[\w.+-]+$/u.test(entry.name))
    .map((entry) => entry.name);
  if (versions.includes('local')) {
    return 'local';
  }
  if (versions.length === 1) {
    return versions[0];
  }
  if (versions.some((version) => comparePlainVersions(version, version) === undefined)) {
    return undefined;
  }
  return versions.toSorted((left, right) => comparePlainVersions(right, left) ?? 0)[0];
};

const pluginWarning = (): PluginCandidates => ({
  candidates: [],
  warning: {
    detail: `Codex plugin ${PLUGIN_ID} is enabled but its installed skill could not be verified — inspect codex plugin list --json; ${PLUGIN_UPDATE_HINT}`,
    name: 'skill',
    status: 'warn',
  },
});

const installedCandidate = async (home: string): Promise<PluginCandidates> => {
  const root = join(home, 'plugins', 'cache', 'refs', 'refs');
  const version = await activeVersion(root);
  if (version === undefined) {
    return pluginWarning();
  }
  const manifest: unknown = JSON.parse(await readFile(join(root, version, 'plugin.json'), 'utf8'));
  if (
    !isObject(manifest) ||
    manifest['$schema'] !== PLUGIN_SCHEMA ||
    manifest['name'] !== 'refs' ||
    manifest['version'] !== version
  ) {
    return pluginWarning();
  }
  const path = join(root, version, 'skills', 'refs', 'SKILL.md');
  await readFile(path, 'utf8');
  return {
    candidates: [
      { display: 'Codex plugin refs@refs', label: 'Codex plugin refs@refs', path, plugin: true },
    ],
  };
};

/** Only inspect the documented plugin identity and an explicitly enabled installation. Cached
 * files left after disabling/removing a plugin are not evidence it is installed. Never execute
 * Codex or traverse unrelated plugins, and honour CODEX_HOME just like standalone discovery. */
const codexPluginCandidates = async (ctx: CliContext): Promise<PluginCandidates> => {
  const home =
    ctx.env['CODEX_HOME']?.trim() ||
    (ctx.homedir.length > 0 ? join(ctx.homedir, '.codex') : undefined);
  if (home === undefined) {
    return { candidates: [] };
  }
  try {
    if (!(await pluginEnabled(home))) {
      return { candidates: [] };
    }
  } catch {
    return { candidates: [] };
  }
  try {
    return await installedCandidate(home);
  } catch {
    return pluginWarning();
  }
};

export { codexPluginCandidates, PLUGIN_UPDATE_HINT };
