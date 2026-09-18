import { SCHEMA_VERSION, zConfig } from './schemas/config.ts';
import { TomlError, parse, stringify } from 'smol-toml';
import { isEnoent, writeFileAtomic } from './fs-atomic.ts';
import { notFoundError, validationError } from './errors.ts';
import { readFile, stat } from 'node:fs/promises';
import type { Config } from './schemas/config.ts';
import type { RefsHome } from './home.ts';
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

export {
  DEFAULT_CONFIG_TOML,
  asRecordOr,
  isPlainObject,
  extractSchemaVersion,
  parseConfigToml,
  readConfig,
  readConfigText,
  seedConfig,
  writeConfig,
};
export type { JsonRecord };
