import { RefsError, notFoundError, validationError } from './errors.ts';
import { SCHEMA_VERSION, zConfig } from './schemas/config.ts';
import { TomlError, parse, stringify } from 'smol-toml';
import { copyFile, readFile, stat } from 'node:fs/promises';
import { isEnoent, writeFileAtomic } from './fs-atomic.ts';
import type { Config } from './schemas/config.ts';
import type { RefsHome } from './home.ts';
import { configBackupPath } from './home.ts';
import { z } from 'zod';

type JsonRecord = Record<string, unknown>;

const isPlainObject = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Returns `value` if it is a plain object, otherwise `fallback` — for raw TOML fields that may
// be absent or malformed.
const asRecordOr = (value: unknown, fallback: JsonRecord): JsonRecord =>
  isPlainObject(value) ? value : fallback;

const DEFAULT_CONFIG_TOML = `# refs configuration
#
# Every global setting under [settings] can also be set per-ref: add the same
# key directly inside a [refs."host/owner/repo"] table to override it just for
# that ref — every global setting is per-ref overridable.

[meta]
schema_version = ${SCHEMA_VERSION}
cli_version = "{{CLI_VERSION}}"

[settings]
# Clone strategy for newly added refs. One of "blobless" (partial clone, default) or "full".
clone_mode = "blobless"
# Transport for npm:-resolved adds: their clone url is rewritten to this before cloning.
# One of "https" (default) or "ssh" (for private-package setups with forge ssh keys).
# Explicitly-typed git urls are always used verbatim.
git_transport = "https"
# How long a ref's fetched state is considered fresh before refs re-fetches it.
# Format: <n>m, <n>h, or <n>d (e.g. "30m", "1h", "1d"). Default: "1h".
sync_ttl = "1h"

[refs]
# Add refs here, one table per ref, keyed by "host/owner/repo". Example:
#
# [refs."github.com/owner/repo"]
# description = "Short description of the repo."
# url = "https://github.com/owner/repo"
# default_branch = "main"
# tag_format = "v{version}"
# # Per-ref overrides of [settings] go in the same table, e.g.:
# # clone_mode = "full"
`;

const readConfigText = async (home: RefsHome): Promise<string> => {
  try {
    return await readFile(home.configPath, 'utf8');
  } catch (error) {
    if (isEnoent(error)) {
      throw notFoundError('no config found — run: refs init');
    }
    throw error;
  }
};

const parseConfigToml = (text: string, path: string): JsonRecord => {
  try {
    return parse(text) as JsonRecord;
  } catch (error) {
    if (error instanceof TomlError) {
      throw validationError(`invalid TOML in ${path}: ${error.message}`);
    }
    throw error;
  }
};

// The lowest schema_version that can ever be valid — matches `zMeta`'s `z.number().int().positive()`.
const MIN_SCHEMA_VERSION = 1;

// A schema_version is only meaningful if it's a positive integer — anything else (a string like
// "1", a float like 1.5, TOML's `nan`/`inf`, zero, or negative) is treated exactly like a missing
// version: it can't be trusted to compare against `SCHEMA_VERSION`, but it also isn't proof the
// config is newer, so it falls into the same "missing/malformed → migratable" bucket everywhere
// this value is consumed (both the read-time gate and the migration decision below).
const isValidSchemaVersion = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= MIN_SCHEMA_VERSION;

const extractSchemaVersion = (raw: JsonRecord): number | undefined => {
  const { meta } = raw;
  if (!isPlainObject(meta)) {
    return undefined;
  }
  const version = meta['schema_version'];
  if (isValidSchemaVersion(version)) {
    return version;
  }
  return undefined;
};

// Runs BEFORE `zConfig.parse` on purpose: an old config (missing newer required fields, or using
// a prior shape) would fail full schema validation with a confusing generic error. Checking the
// raw `meta.schema_version` first gives a precise, actionable message ("upgrade refs" vs. "run:
// refs migrate") before the full-shape validation ever runs.
const assertSupportedSchemaVersion = (raw: JsonRecord, path: string): void => {
  const rawVersion = extractSchemaVersion(raw);
  if (rawVersion === undefined) {
    throw validationError(
      `config schema version is missing or invalid in ${path} — run: refs migrate`,
    );
  }
  if (rawVersion > SCHEMA_VERSION) {
    throw validationError(
      `config schema ${rawVersion} is newer than this CLI supports — upgrade refs`,
    );
  }
  if (rawVersion < SCHEMA_VERSION) {
    throw validationError(
      `config schema ${rawVersion} is older than expected ${SCHEMA_VERSION} — run: refs migrate`,
    );
  }
};

const readConfig = async (home: RefsHome): Promise<Config> => {
  const text = await readConfigText(home);
  const raw = parseConfigToml(text, home.configPath);
  assertSupportedSchemaVersion(raw, home.configPath);
  const result = zConfig.safeParse(raw);
  if (!result.success) {
    throw validationError(z.prettifyError(result.error));
  }
  return result.data;
};

const writeConfig = async (home: RefsHome, config: Config): Promise<void> => {
  const result = zConfig.safeParse(config);
  if (!result.success) {
    throw validationError(z.prettifyError(result.error));
  }
  await writeFileAtomic(home.configPath, stringify(result.data));
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isEnoent(error)) {
      return false;
    }
    throw error;
  }
};

const seedConfig = async (home: RefsHome, cliVersion: string): Promise<'seeded' | 'noop'> => {
  if (await pathExists(home.configPath)) {
    return 'noop';
  }
  await writeFileAtomic(
    home.configPath,
    DEFAULT_CONFIG_TOML.replaceAll('{{CLI_VERSION}}', cliVersion),
  );
  return 'seeded';
};

// Deep-merges `skeleton`'s keys into `target` wherever `target` is missing them. Existing user
// values always win and are never descended into unless the corresponding skeleton value is
// itself a plain object — this fills only *structural* gaps, never leaf values such as settings
// the user didn't set (those stay defaulted by zod at read time, so the file on disk keeps
// reflecting exactly what the user wrote — a deliberate guarantee of migration).
const deepMergeFillMissing = (target: JsonRecord, skeleton: JsonRecord): JsonRecord => {
  const merged: JsonRecord = { ...target };
  for (const [key, skeletonValue] of Object.entries(skeleton)) {
    const currentValue = merged[key];
    if (currentValue === undefined) {
      merged[key] = skeletonValue;
    } else if (isPlainObject(currentValue) && isPlainObject(skeletonValue)) {
      merged[key] = deepMergeFillMissing(currentValue, skeletonValue);
    }
  }
  return merged;
};

// Structural skeleton only — no default *values* — so migration never bakes settings defaults
// into the file. Empty today because SCHEMA_VERSION 1 has no prior version to transform from; a
// future schema bump can widen this (or add per-version transform steps) without changing the
// merge algorithm.
const MIGRATION_SKELETON: JsonRecord = { meta: {}, refs: {}, settings: {} };

// Returns the config's raw text, or `undefined` if the file is absent (any other read failure
// still propagates as a real error).
const readConfigTextOrAbsent = async (home: RefsHome): Promise<string | undefined> => {
  try {
    return await readConfigText(home);
  } catch (error) {
    if (error instanceof RefsError && error.code === 'not_found') {
      return undefined;
    }
    throw error;
  }
};

const assertNotNewerForMigration = (rawVersion: number | undefined): void => {
  if (rawVersion !== undefined && rawVersion > SCHEMA_VERSION) {
    throw validationError(
      `config schema ${rawVersion} is newer than this CLI supports — upgrade refs`,
    );
  }
};

const stampCliVersionIfChanged = async (
  home: RefsHome,
  raw: JsonRecord,
  cliVersion: string,
): Promise<void> => {
  const currentMeta = asRecordOr(raw['meta'], {});
  if (currentMeta['cli_version'] === cliVersion) {
    return;
  }
  const stamped = { ...raw, meta: { ...currentMeta, cli_version: cliVersion } };
  await writeFileAtomic(home.configPath, stringify(stamped));
};

// Backs up the untouched original bytes (overwrite ok if a previous .bak exists), then fills
// structural gaps and bumps the version — `refs.*` entries and unrelated unknown keys are never
// touched, so user data and unknown future keys survive migration.
const migrateOlderConfig = async (
  home: RefsHome,
  raw: JsonRecord,
  cliVersion: string,
): Promise<void> => {
  // Best-effort, not atomic: a crash between this copy and the writeFileAtomic below could in
  // theory race a concurrent migration, but .bak is a convenience safety net, not the durability
  // guarantee (writeFileAtomic below is what protects the actual config from a torn write).
  await copyFile(home.configPath, configBackupPath(home));
  const filled = deepMergeFillMissing(raw, MIGRATION_SKELETON);
  const filledMeta = asRecordOr(filled['meta'], {});
  const migrated = {
    ...filled,
    meta: { ...filledMeta, cli_version: cliVersion, schema_version: SCHEMA_VERSION },
  };
  // Migration must never write a config that `readConfig` can't read back. Validate the fully
  // migrated shape BEFORE the atomic write — e.g. a top-level `settings` that is a string rather
  // than a table survives `deepMergeFillMissing` untouched (it only fills *missing* keys) and
  // would otherwise get stamped with a fresh `schema_version` and written as-is. The backup above
  // has already been written by this point, so a failure here is still recoverable by hand.
  const result = zConfig.safeParse(migrated);
  if (!result.success) {
    throw validationError(
      `config in ${home.configPath} is malformed beyond automatic migration ` +
        `(backup preserved at ${configBackupPath(home)}): ${z.prettifyError(result.error)}`,
    );
  }
  await writeFileAtomic(home.configPath, stringify(migrated));
};

const migrateExistingConfig = async (
  home: RefsHome,
  text: string,
  cliVersion: string,
): Promise<'migrated' | 'noop'> => {
  const raw = parseConfigToml(text, home.configPath);
  const rawVersion = extractSchemaVersion(raw);
  assertNotNewerForMigration(rawVersion);

  if (rawVersion === SCHEMA_VERSION) {
    await stampCliVersionIfChanged(home, raw, cliVersion);
    return 'noop';
  }

  await migrateOlderConfig(home, raw, cliVersion);
  return 'migrated';
};

const migrateConfig = async (
  home: RefsHome,
  cliVersion: string,
): Promise<'seeded' | 'migrated' | 'noop'> => {
  const text = await readConfigTextOrAbsent(home);
  if (text === undefined) {
    await seedConfig(home, cliVersion);
    return 'seeded';
  }
  return migrateExistingConfig(home, text, cliVersion);
};

export { DEFAULT_CONFIG_TOML, migrateConfig, readConfig, seedConfig, writeConfig };
