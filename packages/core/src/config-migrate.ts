import { RefsError, validationError } from './errors.ts';
import { SCHEMA_VERSION, zConfig } from './schemas/config.ts';
import {
  asRecordOr,
  extractSchemaVersion,
  isPlainObject,
  parseConfigToml,
  readConfigText,
  seedConfig,
} from './config-io.ts';
import type { JsonRecord } from './config-io.ts';
import type { RefsHome } from './home.ts';
import { configBackupPath } from './home.ts';
import { copyFile } from 'node:fs/promises';
import { stringify } from 'smol-toml';
import { writeFileAtomic } from './fs-atomic.ts';
import { z } from 'zod';

// `refs migrate`: bringing an existing `config.toml` to the current schema, and leaving it in a
// state `readConfig` can read back. Split from `config-io.ts`, which owns the ordinary read and
// write paths, for the 300-line cap.

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

/** Stamps the running CLI version onto a config already at the current schema, having established
 * that the result is one `readConfig` will accept.
 *
 * `migrate` exists to leave the config in a known-good state, and this branch reported `noop` —
 * "config up to date" — after rewriting the file and validating nothing. Measured: a `clone_mode`
 * of `42` was stamped and reported up to date while every reader then refused the file.
 *
 * What is validated is the STAMPED document, not the document on disk, and the difference is a
 * real one: a config whose `meta.cli_version` is missing or empty fails `zConfig` as it stands and
 * passes once stamped. Repairing that is exactly what this function is for, and validating the
 * input instead would have withdrawn the repair.
 *
 * The check is also outside the "already stamped" early return, so it runs whether or not there is
 * anything to write — `noop` is a claim about the document either way. No backup is named, unlike
 * the older-schema path: nothing has been written when this refuses. */
const stampCliVersionIfChanged = async (
  home: RefsHome,
  raw: JsonRecord,
  cliVersion: string,
): Promise<void> => {
  const currentMeta = asRecordOr(raw['meta'], {});
  const stamped = { ...raw, meta: { ...currentMeta, cli_version: cliVersion } };
  const result = zConfig.safeParse(stamped);
  if (!result.success) {
    const detail = z.prettifyError(result.error);
    throw validationError(
      `config in ${home.configPath} is at the current schema version but does not validate: ${detail}`,
    );
  }
  if (currentMeta['cli_version'] === cliVersion) {
    return;
  }
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

export { migrateConfig };
