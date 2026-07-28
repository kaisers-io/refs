import type { RefEntry, RefKey, RefsHome } from '@kaisers-io/refs-core';
import {
  assertInsideSources,
  canonicalizeGitUrl,
  checkoutPath,
  isGitCheckout,
  readConfig,
  redactUrl,
  resolveHome,
  usageError,
  validationError,
  withLock,
  writeConfig,
  zRefEntry,
} from '@kaisers-io/refs-core';
import type { CliContext } from '../context.ts';
import type { EditData } from './edit.ts';
import { allowFileUrlsFrom } from './add-helpers.ts';
import { editPackageField } from './edit-package.ts';
import { matchRefKey } from './list.ts';
import { normalizeEditValue } from './edit-envelope.ts';
import { requireEntry } from './ref-context.ts';
import { z } from 'zod';

// `refs edit <ref> <field> <value> [--package <name>]` — mutates one top-level ref field, or (with
// `--package`) delegates to `edit-package.ts` for one field of a registered package instead.
// `url` gets its own path (`editUrlField`): the new value is canonicalized and MUST derive the
// same ref key the ref is already stored under (spec: editing url can't silently re-key a ref —
// that's what remove + re-add is for), and the checkout's `origin` remote is rewritten to match
// when a checkout exists. Split out of `edit.ts`/`edit-package.ts` purely to keep each mode's file
// small, per the task brief's up-front three-mode file split.

interface EditRefArgs {
  field: string;
  opts: { packageName?: string };
  query: string;
  value: string;
}

const PACKAGES_FIELD = 'packages';
const URL_FIELD = 'url';
const SUCCESS_EXIT_CODE = 0;

const PACKAGES_USAGE_MESSAGE = 'use --package <name> <field> <value>';
const DIFFERENT_KEY_MESSAGE = 'new url derives a different key — remove and re-add instead';

const refFieldNames = (): string =>
  Object.keys(zRefEntry.shape)
    .filter((name) => name !== PACKAGES_FIELD)
    .toSorted()
    .join(', ');

const unknownFieldMessage = (field: string): string =>
  `unknown ref field '${field}' — valid fields: ${refFieldNames()}`;

const isRefField = (field: string): field is keyof typeof zRefEntry.shape =>
  Object.hasOwn(zRefEntry.shape, field);

// `cloneUrl` is redacted even though it passed canonicalization: a password-less ssh USERNAME
// legally survives it (only passwords are rejected), so a token-shaped username would otherwise
// land in this error and in logs.
const remoteRewriteFailedMessage = (dest: string, cloneUrl: string, stderr: string): string =>
  `failed to rewrite git remote at ${dest} to '${redactUrl(cloneUrl)}': ${stderr.trim()}`;

/** Rewrites `dest`'s `origin` remote to `cloneUrl` via `git remote set-url origin <url>` — but
 * only when `dest` is actually a checkout (an added-but-never-synced ref, or one whose checkout
 * was removed, has nothing to rewrite). `dest` is containment-checked (`assertInsideSources`)
 * FIRST, before even the `isGitCheckout` probe: `git remote set-url` writes `.git/config`, so a
 * symlinked ancestor under sources/ would otherwise get an OUTSIDE repo's origin rewritten — and
 * the caller would then persist the new url to config on top of it. A checkout-less dest still
 * passes the guard (its non-existing suffix resolves inside sources/), keeping the
 * added-but-never-synced edit path working. A failed rewrite (e.g. no `origin` remote configured)
 * surfaces as a `validationError` rather than silently leaving config and checkout out of sync. */
const rewriteRemoteIfCheckedOut = async (
  ctx: CliContext,
  opts: { cloneUrl: string; dest: string; home: RefsHome },
): Promise<void> => {
  assertInsideSources(opts.home, opts.dest);
  if (!isGitCheckout(opts.dest)) {
    return;
  }
  const result = await ctx.runner.run('git', ['remote', 'set-url', 'origin', opts.cloneUrl], {
    cwd: opts.dest,
  });
  if (result.exitCode !== SUCCESS_EXIT_CODE) {
    throw validationError(remoteRewriteFailedMessage(opts.dest, opts.cloneUrl, result.stderr));
  }
};

const editUrlField = async (
  ctx: CliContext,
  args: { entry: RefEntry; home: RefsHome; key: RefKey; value: string },
): Promise<RefEntry> => {
  const canonical = canonicalizeGitUrl(args.value, { allowFileUrls: allowFileUrlsFrom(ctx.env) });
  if (canonical.key !== args.key) {
    throw validationError(DIFFERENT_KEY_MESSAGE);
  }
  const dest = checkoutPath(args.home, args.key);
  await rewriteRemoteIfCheckedOut(ctx, { cloneUrl: canonical.cloneUrl, dest, home: args.home });
  return { ...args.entry, url: canonical.cloneUrl };
};

const editPlainRefField = (
  entry: RefEntry,
  field: keyof typeof zRefEntry.shape,
  value: string,
): RefEntry => {
  const candidate = { ...entry, [field]: value };
  const parsed = zRefEntry.safeParse(candidate);
  if (!parsed.success) {
    throw validationError(z.prettifyError(parsed.error));
  }
  return parsed.data;
};

/** `url` needs its own (async, checkout-touching) path; every other recognized field is a plain
 * re-validated assignment (`editPlainRefField`). Written as two early-return branches rather than
 * a ternary — this repo's oxlint config forbids `no-ternary`. */
const resolveUpdatedEntry = (
  ctx: CliContext,
  args: {
    entry: RefEntry;
    field: keyof typeof zRefEntry.shape;
    home: RefsHome;
    key: RefKey;
    value: string;
  },
): Promise<RefEntry> => {
  if (args.field === URL_FIELD) {
    return editUrlField(ctx, {
      entry: args.entry,
      home: args.home,
      key: args.key,
      value: args.value,
    });
  }
  return Promise.resolve(editPlainRefField(args.entry, args.field, args.value));
};

const editTopLevelField = async (
  ctx: CliContext,
  args: { entry: RefEntry; field: string; home: RefsHome; key: RefKey; value: string },
): Promise<{ new: unknown; old: unknown; updated: RefEntry }> => {
  const { field } = args;
  if (field === PACKAGES_FIELD) {
    throw usageError(PACKAGES_USAGE_MESSAGE);
  }
  if (!isRefField(field)) {
    throw usageError(unknownFieldMessage(field));
  }
  const old: unknown = args.entry[field];
  const updated = await resolveUpdatedEntry(ctx, {
    entry: args.entry,
    field,
    home: args.home,
    key: args.key,
    value: args.value,
  });
  return { new: updated[field], old, updated };
};

const runEditRef = (ctx: CliContext, args: EditRefArgs): Promise<EditData> => {
  const home = resolveHome(ctx.env);
  const { field, opts, query, value } = args;
  return withLock(home, 'home', async () => {
    const config = await readConfig(home);
    const key = matchRefKey(config, query);
    const entry = requireEntry(config, key);
    if (opts.packageName !== undefined) {
      return editPackageField({
        config,
        entry,
        field,
        home,
        key,
        packageName: opts.packageName,
        value,
      });
    }
    const result = await editTopLevelField(ctx, { entry, field, home, key, value });
    await writeConfig(home, { ...config, refs: { ...config.refs, [key]: result.updated } });
    return {
      field,
      key,
      new: normalizeEditValue(result.new),
      old: normalizeEditValue(result.old),
    };
  });
};

export { runEditRef };
