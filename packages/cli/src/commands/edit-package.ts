import type { Config, PackageEntry, RefEntry, RefKey, RefsHome } from '@kaisers-io/refs-core';
import {
  notFoundError,
  usageError,
  validationError,
  writeConfig,
  zPackageEntry,
} from '@kaisers-io/refs-core';
import type { EditData } from './edit.ts';
import { normalizeEditValue } from './edit-envelope.ts';
import { z } from 'zod';

// `refs edit <ref> <field> <value> --package <name>` — mutates one field on a package registered
// under a ref's `packages` table. Split out of `edit-ref.ts` purely to keep each mode's file small
// (the task brief calls out `edit`'s three-mode split up front). Never touches the checkout or git
// — packages carry no `url`/transport concerns of their own, unlike the ref-level `url` field.

type EditPackageArgs = {
  config: Config;
  entry: RefEntry;
  field: string;
  home: RefsHome;
  key: RefKey;
  packageName: string;
  value: string;
};

const packageFieldNames = (): string => Object.keys(zPackageEntry.shape).toSorted().join(', ');

const unknownPackageFieldMessage = (field: string): string =>
  `unknown package field '${field}' — valid fields: ${packageFieldNames()}`;

const isPackageField = (field: string): field is keyof typeof zPackageEntry.shape =>
  Object.hasOwn(zPackageEntry.shape, field);

/** An unregistered `packageName` is a `notFoundError`, mirroring `tag.ts`'s `formatFor` — an
 * `--package` naming a package that was never added to the ref is a lookup failure, not a usage
 * mistake. */
const requirePackage = (entry: RefEntry, key: RefKey, packageName: string): PackageEntry => {
  const pkg = entry.packages?.[packageName];
  if (pkg === undefined) {
    throw notFoundError(`no package '${packageName}' registered on ref '${key}'`);
  }
  return pkg;
};

type PackageFieldEdit = {
  field: keyof typeof zPackageEntry.shape;
  newValue: unknown;
  oldValue: unknown;
  updated: PackageEntry;
};

/** Pure (sync) core of the edit: validates `field` against `zPackageEntry`'s own shape, then
 * re-validates the WHOLE package entry (not just the touched field) — mirrors
 * `edit-settings.ts`'s `runEditSettings`. Split out of `editPackageField` purely to keep that
 * function's statement count under the repo's oxlint cap. */
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

export { editPackageField };
