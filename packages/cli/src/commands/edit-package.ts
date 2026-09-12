import type { Config, PackageEntry, RefEntry, RefKey, RefsHome } from '@kaisers-io/refs-core';
import {
  readConfig,
  resolveHome,
  usageError,
  validationError,
  withLock,
  writeConfig,
  zPackageEntry,
  zRefEntry,
} from '@kaisers-io/refs-core';
import { requireEntry, requirePackage } from './ref-context.ts';
import type { CliContext } from '../context.ts';
import type { EditData } from './edit.ts';
import { matchRefKey } from './list.ts';
import { normalizeEditValue } from './edit-envelope.ts';
import { z } from 'zod';

// `refs edit <ref> <field> <value> --package <name>` — mutates one field on a package registered
// under a ref's `packages` table. One of edit's three mode modules (see edit.ts for the
// dispatch). Never touches the checkout or git — packages carry no `url`/transport concerns of
// their own, unlike the ref-level `url` field.
//
// `--create` (`createPackageEntry`) is the second mode here, and the only writer besides `add`
// that adds a package to a ref. It exists because an `unregistered` drift finding had no repair:
// `refs add` refuses an already-tracked ref, and the field edits below need an entry to edit — so
// the only instruction anyone could give was "hand-edit config.toml". It is deliberately a
// SEPARATE mode rather than an upsert on the field edits: a misspelled `--package` name in an
// ordinary edit must keep failing with `not_found`, never quietly register a new package.

type EditPackageArgs = {
  config: Config;
  entry: RefEntry;
  field: string;
  home: RefsHome;
  key: RefKey;
  packageName: string;
  value: string;
};

const PACKAGES_FIELD = 'packages';

const packageFieldNames = (): string => Object.keys(zPackageEntry.shape).toSorted().join(', ');

const unknownPackageFieldMessage = (field: string): string =>
  `unknown package field '${field}' — valid fields: ${packageFieldNames()}`;

const isPackageField = (field: string): field is keyof typeof zPackageEntry.shape =>
  Object.hasOwn(zPackageEntry.shape, field);

type PackageFieldEdit = {
  field: keyof typeof zPackageEntry.shape;
  newValue: unknown;
  oldValue: unknown;
  updated: PackageEntry;
};

/** Pure (sync) core of the edit: validates `field` against `zPackageEntry`'s own shape, then
 * re-validates the WHOLE package entry (not just the touched field) — mirrors
 * `edit-settings.ts`'s `runEditSettings`. */
const applyPackageFieldEdit = (
  pkg: PackageEntry,
  field: string,
  value: string,
): PackageFieldEdit => {
  if (!isPackageField(field)) {
    throw usageError(unknownPackageFieldMessage(field));
  }
  const oldValue: unknown = pkg[field];
  const parsed = zPackageEntry.safeParse({ ...pkg, [field]: value });
  if (!parsed.success) {
    throw validationError(z.prettifyError(parsed.error));
  }
  return { field, newValue: parsed.data[field], oldValue, updated: parsed.data };
};

/** Mutates one field of `args.packageName`'s package entry (via `applyPackageFieldEdit`) and
 * writes the whole config back. An unrecognized `field` is a `usageError` listing every valid
 * package field; an unregistered `packageName` is a `notFoundError` (see `requirePackage`). */
const editPackageField = async (args: EditPackageArgs): Promise<EditData> => {
  const pkg = requirePackage(args.entry, args.key, args.packageName);
  const result = applyPackageFieldEdit(pkg, args.field, args.value);
  const updatedEntry: RefEntry = {
    ...args.entry,
    packages: { ...args.entry.packages, [args.packageName]: result.updated },
  };
  await writeConfig(args.home, {
    ...args.config,
    refs: { ...args.config.refs, [args.key]: updatedEntry },
  });
  return {
    field: result.field,
    key: args.key,
    new: normalizeEditValue(result.newValue),
    old: normalizeEditValue(result.oldValue),
  };
};

/** Where `--create`'s two fields come from, alongside the ref and package they name. */
type CreatePackageArgs = {
  description: string;
  packageName: string;
  path: string;
  query: string;
};

const alreadyRegisteredMessage = (name: string, key: RefKey): string =>
  `package '${name}' is already registered on ref '${key}' — edit its fields instead`;

/** Registers a package the configuration did not have.
 *
 * The whole `zRefEntry` is re-validated rather than just the new `zPackageEntry`, because the
 * package NAME is validated by the record schema wrapping the table (`zSafePackagesRecord`
 * rejects an empty or prototype-shaped key), not by the entry schema inside it. `writeConfig`
 * would refuse such a name too — it re-validates the entire config — so this is the earlier and
 * better-located of two checks rather than the only one, and it mirrors what `editPackageField`
 * does one function up.
 *
 * The computed key below produces a REAL own property even for `__proto__` (an object literal's
 * computed keys use CreateDataProperty, not [[Set]]), so the record schema does see it. A spread
 * assignment would too; `obj.__proto__ = x` would not, which is why neither is used.
 *
 * `Object.hasOwn` rather than a lookup, for the same family of reasons: `packages?.['__proto__']`
 * answers with `Object.prototype` and would report a prototype-shaped name as already registered
 * instead of letting the schema reject it by name. */
const createPackageEntry = (ctx: CliContext, args: CreatePackageArgs): Promise<EditData> => {
  const home = resolveHome(ctx.env);
  return withLock(home, 'home', async () => {
    const config = await readConfig(home);
    const key = matchRefKey(config, args.query);
    const entry = requireEntry(config, key);
    if (Object.hasOwn(entry.packages ?? {}, args.packageName)) {
      throw validationError(alreadyRegisteredMessage(args.packageName, key));
    }
    const parsed = zRefEntry.safeParse({
      ...entry,
      packages: {
        ...entry.packages,
        [args.packageName]: { description: args.description, path: args.path },
      },
    });
    if (!parsed.success) {
      throw validationError(z.prettifyError(parsed.error));
    }
    await writeConfig(home, { ...config, refs: { ...config.refs, [key]: parsed.data } });
    return {
      created: true,
      field: PACKAGES_FIELD,
      key,
      new: { description: args.description, name: args.packageName, path: args.path },
      // eslint-disable-next-line unicorn/no-null -- cross-process JSON contract requires null
      old: null,
    };
  });
};

const notRegisteredMessage = (name: string, key: RefKey): string =>
  `package '${name}' is not registered on ref '${key}' — nothing to remove`;

/** Unregisters a package the configuration has.
 *
 * A CONFIGURATION operation, deliberately: it asks nothing of the checkout. The finding that sends
 * someone here is `missing` — "gone from this repo's workspaces" — but a user may also stop
 * tracking a package that is still there, and a checkout guard would turn that into an argument
 * with the tool. Removal works with an absent or unreadable checkout for the same reason
 * `--create` does not verify one.
 *
 * A distinct mode rather than an upsert, matching `--create`: naming a package the configuration
 * does not have fails rather than quietly succeeding, so a typo cannot look like it worked. It
 * cannot protect against a typo that names a DIFFERENT registered package — nothing can — which is
 * why the removed entry comes back as `old` for the caller to show.
 *
 * Unregistering is not suppression: a package still declared in the checkout will be reported as
 * `unregistered` by the next full discovery. That is correct, and a standing "never mention this
 * again" would be a different feature. */
const removePackageEntry = (
  ctx: CliContext,
  args: { packageName: string; query: string },
): Promise<EditData> => {
  const home = resolveHome(ctx.env);
  return withLock(home, 'home', async () => {
    const config = await readConfig(home);
    const key = matchRefKey(config, args.query);
    const entry = requireEntry(config, key);
    const packages = entry.packages ?? {};
    if (!Object.hasOwn(packages, args.packageName)) {
      throw validationError(notRegisteredMessage(args.packageName, key));
    }
    const { [args.packageName]: removed, ...rest } = packages;
    // An empty `packages` table is omitted rather than written as `{}`: that is how a ref with no
    // packages is represented everywhere else, and `{}` would read as "this ref configures none"
    // through a different shape.
    const next =
      Object.keys(rest).length === 0 ? withoutPackages(entry) : { ...entry, packages: rest };
    await writeConfig(home, { ...config, refs: { ...config.refs, [key]: next } });
    return {
      field: PACKAGES_FIELD,
      key,
      // eslint-disable-next-line unicorn/no-null -- cross-process JSON contract requires null
      new: null,
      old: {
        description: removed?.description ?? '',
        name: args.packageName,
        path: removed?.path ?? '',
      },
      removed: true,
    };
  });
};

/** `entry` without its `packages` key at all — `exactOptionalPropertyTypes` distinguishes an absent
 * key from one set to `undefined`, and TOML can write only the former. */
const withoutPackages = (entry: RefEntry): RefEntry => {
  const { packages: _packages, ...rest } = entry;
  return rest;
};

export { createPackageEntry, editPackageField, removePackageEntry };
