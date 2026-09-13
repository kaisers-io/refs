import type { Config, DeclinedPackage, RefEntry, RefKey } from '@kaisers-io/refs-core';
import {
  readConfig,
  resolveHome,
  validationError,
  withLock,
  writeConfig,
} from '@kaisers-io/refs-core';
import type { CliContext } from '../context.ts';
import type { EditData } from './edit.ts';
import { matchRefKey } from './list.ts';
import { requireEntry } from './ref-context.ts';

// `refs edit <ref> --package <name> --path <path> --decline|--undecline` — records that someone
// looked at a package the checkout declares and decided not to route to it.
//
// The finding it answers is `unregistered`, and before this there was no answer at all: the
// package stayed in every report forever, so `config-drift` sat on WARN permanently and the next
// real finding arrived in a line already being ignored.
//
// What a decline is NOT: it is not a claim that the package is gone, it is not a claim that it is
// uninteresting to anyone else, and it never touches a finding about a CONFIGURED entry. Those say
// the configuration and the checkout disagree, and no decision about registration makes that
// untrue. `drift-discovery.ts` enforces that half.

const DECLINED_FIELD = 'declined_packages';

const samePackage = (left: DeclinedPackage, right: DeclinedPackage): boolean =>
  left.name === right.name && left.path === right.path;

/** The entry's declined list without one record, and without the key at all when that empties it.
 * `exactOptionalPropertyTypes` distinguishes an absent key from one set to `undefined`, and TOML
 * can write only the former. Exported because `--create` clears a matching decline in the same
 * write that registers the package: leaving it behind would keep a stale decision on record for a
 * package the configuration now has. */
const withoutDecline = (entry: RefEntry, record: DeclinedPackage): RefEntry => {
  const kept = (entry.declined_packages ?? []).filter((item) => !samePackage(item, record));
  if (kept.length === 0) {
    const { declined_packages: _declined, ...rest } = entry;
    return rest;
  }
  return { ...entry, declined_packages: kept };
};

const alreadyDeclinedMessage = (record: DeclinedPackage, key: RefKey): string =>
  `package '${record.name}' at '${record.path}' is already declined on ref '${key}'`;

const notDeclinedMessage = (record: DeclinedPackage, key: RefKey): string =>
  `package '${record.name}' at '${record.path}' is not declined on ref '${key}' — nothing to undo`;

const registeredMessage = (name: string, key: RefKey): string =>
  `package '${name}' is registered on ref '${key}' — declining applies to packages the ` +
  'configuration does not have; unregister it first with --remove';

/** The declined list with one record added, or the reason it cannot be. A package the ref already
 * registers is refused rather than recorded: the finding a decline suppresses does not exist for a
 * registered package, so the record would be a decision about nothing — and storing it would leave
 * a trap for whoever unregisters the package later. */
const withDecline = (entry: RefEntry, record: DeclinedPackage, key: RefKey): RefEntry => {
  if (Object.hasOwn(entry.packages ?? {}, record.name)) {
    throw validationError(registeredMessage(record.name, key));
  }
  const declined = entry.declined_packages ?? [];
  if (declined.some((item) => samePackage(item, record))) {
    throw validationError(alreadyDeclinedMessage(record, key));
  }
  return { ...entry, declined_packages: [...declined, record] };
};

const nextEntry = (args: {
  declined: boolean;
  entry: RefEntry;
  key: RefKey;
  record: DeclinedPackage;
}): RefEntry => {
  if (args.declined) {
    return withDecline(args.entry, args.record, args.key);
  }
  if (!(args.entry.declined_packages ?? []).some((item) => samePackage(item, args.record))) {
    throw validationError(notDeclinedMessage(args.record, args.key));
  }
  return withoutDecline(args.entry, args.record);
};

/** Records or withdraws one decision. A CONFIGURATION operation that asks nothing of the checkout,
 * for the same reason `--create` and `--remove` do not: the decision is about the entry, and it has
 * to be recordable while the checkout is stale, absent, or still carrying the directory. */
const declinePackageEntry = (
  ctx: CliContext,
  args: { declined: boolean; packageName: string; path: string; query: string },
): Promise<EditData> => {
  const home = resolveHome(ctx.env);
  return withLock(home, 'home', async () => {
    const config: Config = await readConfig(home);
    const key = matchRefKey(config, args.query);
    const entry = requireEntry(config, key);
    const record: DeclinedPackage = { name: args.packageName, path: args.path };
    const next = nextEntry({ declined: args.declined, entry, key, record });
    await writeConfig(home, { ...config, refs: { ...config.refs, [key]: next } });
    return {
      declined: args.declined,
      field: DECLINED_FIELD,
      key,
      // eslint-disable-next-line unicorn/no-null -- cross-process JSON contract requires null
      new: args.declined ? record : null,
      // eslint-disable-next-line unicorn/no-null -- cross-process JSON contract requires null
      old: args.declined ? null : record,
    };
  });
};

export { declinePackageEntry, withoutDecline };
