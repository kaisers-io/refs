import { createPackageEntry, removePackageEntry } from './edit-package.ts';
import type { CliContext } from '../context.ts';
import type { EditData } from './edit.ts';
import { declinePackageEntry } from './edit-decline.ts';
import { usageError } from '@kaisers-io/refs-core';

// Which package mode `refs edit` is in, and whether the flags for it are complete.
//
// Split from `edit.ts` for the 300-line cap. `edit.ts` keeps the command surface — argument
// registration, the settings/field dispatch, human rendering; everything here is about the four
// mutually exclusive modes that operate on ONE package of a ref and take no `<field> <value>`
// pair.
//
// Each mode checks its whole shape at once rather than one flag per attempt: a partial invocation
// should name everything missing in a single run. And a `<field> <value>` pair alongside any of
// them is two mutually exclusive forms in one command — refused, never guessed, because guessing
// is how a field edit turns into a silent registration.

type CreateOptions = {
  create?: boolean;
  decline?: boolean;
  description?: string;
  path?: string;
  remove?: boolean;
  undecline?: boolean;
};

type ModeArgs = {
  create: CreateOptions;
  first: string;
  packageName: string | undefined;
  second: string | undefined;
  value: string | undefined;
};

type PackageMode = 'create' | 'decline' | 'remove' | 'undecline';

const CREATE_USAGE_MESSAGE =
  '--create registers a new package: it needs --package <name>, --path <path> and ' +
  '--description <text>, and takes no <field> <value> arguments';
const REMOVE_USAGE_MESSAGE =
  '--remove unregisters a package: it needs --package <name>, and takes no <field> <value> ' +
  'arguments, no --path and no --description';
const DECLINE_USAGE_MESSAGE =
  '--decline and --undecline record a decision about one package at one path: each needs ' +
  '--package <name> and --path <path>, and takes no <field> <value> arguments and no --description';
const ONE_MODE_MESSAGE =
  'use one of --create, --remove, --decline or --undecline: they are different answers about the ' +
  'same package, and running two at once would guess which one was meant';

const noPositionals = (args: ModeArgs): boolean =>
  args.second === undefined && args.value === undefined;

const requireCreateShape = (
  args: ModeArgs,
): { description: string; packageName: string; path: string } => {
  const { description, path } = args.create;
  const { packageName } = args;
  if (packageName === undefined || description === undefined || path === undefined) {
    throw usageError(CREATE_USAGE_MESSAGE);
  }
  if (!noPositionals(args)) {
    throw usageError(CREATE_USAGE_MESSAGE);
  }
  return { description, packageName, path };
};

const requireRemoveShape = (args: ModeArgs): { packageName: string } => {
  const { packageName } = args;
  if (packageName === undefined || args.create.path !== undefined) {
    throw usageError(REMOVE_USAGE_MESSAGE);
  }
  if (!noPositionals(args) || args.create.description !== undefined) {
    throw usageError(REMOVE_USAGE_MESSAGE);
  }
  return { packageName };
};

/** A decline names a path as well as a name. Neither identifies the decision on its own: a name
 * alone would also silence a different package that later takes it, and a path alone would
 * silence whatever moves in. The path is not inferred from a scan either — `doctor` prints the
 * observed one into the command, and a path guessed from a scan that may be incomplete is exactly
 * the claim refs must not make. */
const requireDeclineShape = (args: ModeArgs): { packageName: string; path: string } => {
  const { packageName } = args;
  const { path } = args.create;
  if (packageName === undefined || path === undefined) {
    throw usageError(DECLINE_USAGE_MESSAGE);
  }
  if (!noPositionals(args) || args.create.description !== undefined) {
    throw usageError(DECLINE_USAGE_MESSAGE);
  }
  return { packageName, path };
};

const MODE_FLAGS: readonly PackageMode[] = ['create', 'remove', 'decline', 'undecline'];

/** The mode a set of flags selects, or `undefined` for the ordinary `<field> <value>` form. More
 * than one is refused rather than resolved. */
const packageModeOf = (create: CreateOptions): PackageMode | undefined => {
  const chosen = MODE_FLAGS.filter((mode) => create[mode] === true);
  if (chosen.length > 1) {
    throw usageError(ONE_MODE_MESSAGE);
  }
  return chosen[0];
};

const runPackageMode = (ctx: CliContext, mode: PackageMode, args: ModeArgs): Promise<EditData> => {
  if (mode === 'create') {
    return createPackageEntry(ctx, { ...requireCreateShape(args), query: args.first });
  }
  if (mode === 'remove') {
    return removePackageEntry(ctx, { ...requireRemoveShape(args), query: args.first });
  }
  return declinePackageEntry(ctx, {
    ...requireDeclineShape(args),
    declined: mode === 'decline',
    query: args.first,
  });
};

export { packageModeOf, runPackageMode };
export type { CreateOptions, ModeArgs, PackageMode };
