import type { Config, Settings } from '@kaisers-io/refs-core';
import {
  RefsError,
  readConfig,
  resolveHome,
  usageError,
  validationError,
  withLock,
  writeConfig,
  zSettings,
} from '@kaisers-io/refs-core';
import type { CliContext } from '../context.ts';
import type { EditData } from './edit.ts';
import { matchRefKey } from './list.ts';
import { normalizeEditValue } from './edit-envelope.ts';
import { z } from 'zod';

// `refs edit settings <key> <value>` — mutates exactly one global setting, re-validating the
// WHOLE `zSettings` object (not just the one field) so a value that's individually well-formed but
// breaks some future cross-field invariant would still be caught. Split out of `edit-ref.ts`/
// `edit-package.ts` purely to keep each mode's file small and independently readable — the task
// brief calls out that `edit` has three modes and should be planned as a split up front.

interface EditSettingsArgs {
  key: string;
  value: string;
}

interface EditSettingsResult {
  data: EditData;
  warnings: string[];
}

const SETTINGS_MODE_KEY = 'settings';
const NO_WARNINGS: string[] = [];

const settingsKeyNames = (): string => Object.keys(zSettings.shape).toSorted().join(', ');

const unknownSettingMessage = (key: string): string =>
  `unknown setting '${key}' — valid settings: ${settingsKeyNames()}`;

// `Object.hasOwn` against the schema's own shape, not a hand-maintained list — the set of valid
// setting keys can only ever drift out of sync with `zSettings` if someone bypasses this check.
const isSettingsKey = (key: string): key is keyof typeof zSettings.shape =>
  Object.hasOwn(zSettings.shape, key);

const collisionNote = (detail: string): string =>
  `note: 'settings' addressed the global settings, not ${detail} — use the full ref key to ` +
  'edit that ref';

const AMBIGUOUS_COLLISION_DETAIL = 'one of several matching refs — see `refs list`';

/** Detects `edit.ts`'s documented silent-collision case: a configured ref reachable by the bare
 * suffix `'settings'` (e.g. `github.com/acme/settings`) can never itself be reached through
 * `refs edit settings ...`, because that reserved word always dispatches to global settings first.
 * Reuses `matchRefKey` purely as a probe — a `usageError` it throws for an ambiguous suffix (more
 * than one ref ending in `/settings`) still means "some ref matches", just not uniquely, so that
 * counts too; a `notFoundError` means no ref collides at all and no warning is warranted. */
const collisionWarnings = (config: Config): string[] => {
  try {
    const key = matchRefKey(config, SETTINGS_MODE_KEY);
    return [collisionNote(`ref '${key}'`)];
  } catch (error) {
    if (error instanceof RefsError && error.code === 'usage') {
      return [collisionNote(AMBIGUOUS_COLLISION_DETAIL)];
    }
    if (error instanceof RefsError && error.code === 'not_found') {
      return NO_WARNINGS;
    }
    throw error;
  }
};

interface SettingsEditOutcome {
  config: Config;
  key: keyof typeof zSettings.shape;
  old: unknown;
  parsed: Settings;
}

/** Builds the final `{data, warnings}` result once the write has already gone through — split out
 * of `runEditSettings` purely to keep that function's statement count under the repo's
 * `max-statements` oxlint cap, mirroring `edit-package.ts`'s `applyPackageFieldEdit` split. */
const buildEditSettingsResult = (outcome: SettingsEditOutcome): EditSettingsResult => {
  const data: EditData = {
    field: outcome.key,
    key: SETTINGS_MODE_KEY,
    new: normalizeEditValue(outcome.parsed[outcome.key]),
    old: normalizeEditValue(outcome.old),
  };
  return { data, warnings: collisionWarnings(outcome.config) };
};

/** Mutates one global setting under the home lock: rejects an unrecognized `key` with a
 * `usageError` listing every valid setting, and rejects a value that fails `zSettings`
 * (re-validated as a whole, not just the touched field) with a `validationError` carrying zod's
 * prettified message. Only ever writes the config once every check has passed. Also surfaces
 * `collisionWarnings` in the returned envelope — settings mode always wins the reserved-word
 * dispatch, but a ref addressable by the same suffix should never be silently shadowed. */
const runEditSettings = (ctx: CliContext, args: EditSettingsArgs): Promise<EditSettingsResult> => {
  const home = resolveHome(ctx.env);
  return withLock(home, 'home', async () => {
    const config = await readConfig(home);
    if (!isSettingsKey(args.key)) {
      throw usageError(unknownSettingMessage(args.key));
    }
    const old: unknown = config.settings[args.key];
    const candidate = { ...config.settings, [args.key]: args.value };
    const parsed = zSettings.safeParse(candidate);
    if (!parsed.success) {
      throw validationError(z.prettifyError(parsed.error));
    }
    await writeConfig(home, { ...config, settings: parsed.data });
    return buildEditSettingsResult({ config, key: args.key, old, parsed: parsed.data });
  });
};

export { runEditSettings };
