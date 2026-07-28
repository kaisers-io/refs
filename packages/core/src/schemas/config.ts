import { withValidatedKeys, zSafePackagesRecord } from './record-keys.ts';
import {
  zCloneMode,
  zDuration,
  zGitTransport,
  zPackagePath,
  zRefKey,
  zTagFormat,
} from './primitives.ts';
import { z } from 'zod';

const SCHEMA_VERSION = 1;

const SETTINGS_DEFAULTS = {
  clone_mode: 'blobless',
  // 'https', not 'ssh': git_transport has ACTIVE semantics (npm:-resolved clone urls are
  // rewritten to it at add time), so an ssh default would break
  // `refs add npm:<public-package>` on machines without forge ssh keys. https preserves the
  // anonymous-clone behavior; ssh is the opt-in for private-package setups.
  git_transport: 'https',
  sync_ttl: '1h',
} as const;

const zSettings = z.strictObject({
  clone_mode: zCloneMode.default(SETTINGS_DEFAULTS.clone_mode),
  git_transport: zGitTransport.default(SETTINGS_DEFAULTS.git_transport),
  // `zDuration.default(...)` expects an already-branded Duration, not a plain string literal
  // (brands can't be produced by assignment). Parsing the literal here both attests the brand
  // and self-validates the constant at module load, so no unchecked `as Duration` cast is needed.
  sync_ttl: zDuration.default(zDuration.parse(SETTINGS_DEFAULTS.sync_ttl)),
});

// Maps each field of a defaulted-fields shape to an optional schema with the default removed,
// preserving the exact per-key inner type (ZodEnum, branded ZodString, …) via the conditional
// mapped type below — no field collapses to a generic/unknown type.
type WithoutDefaults<Shape extends z.ZodRawShape> = {
  [Key in keyof Shape]: Shape[Key] extends z.ZodDefault<infer Inner> ? z.ZodOptional<Inner> : never;
};

const removeDefaults = <Shape extends z.ZodRawShape>(shape: Shape): WithoutDefaults<Shape> =>
  // Object.fromEntries necessarily widens to a homogeneous [string, ZodTypeAny][] tuple list,
  // losing the per-key correlation TS could otherwise track — this is the single, well-contained
  // assertion needed to restore the precise `WithoutDefaults<Shape>` type computed above. The
  // runtime shape (same keys, each unwrapped + optional) matches the asserted type exactly.
  Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [
      key,
      (schema as z.ZodDefault<z.ZodTypeAny>).removeDefault().optional(),
    ]),
  ) as unknown as WithoutDefaults<Shape>;

// Derived, never hand-written: guarantees the invariant that EVERY global setting is
// per-ref overridable — a setting that is not overridable cannot exist by construction.
//
// `zSettings.partial()` looked simpler, but Zod 4 still applies each field's `.default()` when
// a partial-wrapped field is absent — `zRefSettingsOverride.parse({})` would come back as
// `{ clone_mode: 'blobless', sync_ttl: '1h', git_transport: 'https' }` instead of `{}`. That breaks
// resolution: an absent per-ref override must stay absent so `resolveSetting` falls through to
// the global setting. `removeDefaults` strips each default before wrapping in `.optional()`, so
// `{}` really does parse to `{}`.
const zRefSettingsOverride = z.strictObject(removeDefaults(zSettings.shape));

const zPackageEntry = z.strictObject({
  description: z.string().min(1),
  path: zPackagePath,
  tag_format: zTagFormat.optional(),
});

const zRefEntry = z.strictObject({
  default_branch: z.string().min(1),
  description: z.string().min(1),
  packages: zSafePackagesRecord(zPackageEntry).optional(),
  tag_format: zTagFormat,
  url: z.string().min(1),
  ...zRefSettingsOverride.shape,
});

// Meta is looseObject: keys written by future CLI versions must survive a read → write
// round-trip by an older CLI (forward-compat guarantee).
const zMeta = z.looseObject({
  cli_version: z.string().min(1),
  schema_version: z.number().int().positive(),
});

const REF_KEY_ISSUE_MESSAGE = 'ref key must be host/path…/repo with safe, non-empty segments';

// Keyed by plain `z.string()`, not `zRefKey`, on purpose: Zod 4 types `z.record` of a
// branded/refined key schema as `Record<string & $brand<'RefKey'>, …>`, whose index signature
// rejects indexing by plain string literals (as `Config['refs'][someLiteralKey]` needs to, e.g.
// in consumers that look up a parsed config by a known ref key). `withValidatedKeys` restores the
// same runtime rejection of malformed keys that `z.record(zRefKey, …)` would give — validated on
// the raw input, see the comment above — while keeping the public type as the far more usable
// `Record<string, RefEntry>`.
const zRefs = withValidatedKeys(
  (key) => zRefKey.safeParse(key).success,
  () => REF_KEY_ISSUE_MESSAGE,
  z.record(z.string(), zRefEntry),
);

const zConfig = z.strictObject({
  meta: zMeta,
  refs: zRefs.default({}),
  settings: zSettings,
});

type Config = z.infer<typeof zConfig>;
type PackageEntry = z.infer<typeof zPackageEntry>;
type RefEntry = z.infer<typeof zRefEntry>;
type Settings = z.infer<typeof zSettings>;

export {
  SCHEMA_VERSION,
  SETTINGS_DEFAULTS,
  zConfig,
  zPackageEntry,
  zRefEntry,
  zRefSettingsOverride,
  zSettings,
};
export type { Config, PackageEntry, RefEntry, Settings };
