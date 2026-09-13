import type { EntryPoints, RefKey, RefsHome, TargetNode } from '@kaisers-io/refs-core';
import type { PackageStatus } from './resolve-verify.ts';
import { join } from 'node:path';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { readEntryPoints } from '@kaisers-io/refs-core';
import { verifyPackageLocation } from './resolve-verify.ts';

// The `package` half of `refs resolve`'s payload: its JSON shape, how it is produced (which means
// verifying the configured location, not just joining it), and how it renders for a human.
// Separate from `resolve.ts` so the routing logic there — already dense with four-step precedence
// rules — stays readable.

type ResolvePackage = {
  candidates?: string[];
  configured_path?: string;
  /** What the package's manifest declares as its entry points, and what is at each target.
   *
   * Present only for a package whose location was VERIFIED — the directory whose manifest names
   * this package, not the configured path the lookup started from. Declarations read out of an
   * unverified directory would describe some other package.
   *
   * An absent target is not a defect in the dependency: a source checkout is not built, so
   * `dist/…` is absent in every repository refs tracks that ships one. It says what is in THIS
   * checkout, and nothing about the package's health. */
  entry_points?: EntryPoints;
  // `null` when the package has no known location: `missing` (nowhere in a complete scan) or
  // `ambiguous` (the name occurs at several paths and picking one would be a guess). Callers
  // that treat a zero exit as "here is a usable path" must check `status` first — before this
  // existed, `local_path` was always a string.
  local_path: string | null;
  name: string;
  path: string | null;
  reason?: string;
  status: PackageStatus;
};

/** What a package resolves to when the checkout it would live in is not one refs manages.
 *
 * Verification reads a manifest at a path and compares a name; against an unrelated checkout it can
 * perfectly well answer `verified` — for a package that has nothing to do with the configured ref.
 * So the checkout's identity gates it: without that, this feature would report confidence in
 * exactly the case it exists to catch. */
const unverifiedPackage = (packageName: string, reason: string): ResolvePackage => ({
  // eslint-disable-next-line unicorn/no-null -- cross-process JSON contract requires null
  local_path: null,
  name: packageName,
  // eslint-disable-next-line unicorn/no-null -- cross-process JSON contract requires null
  path: null,
  reason,
  status: 'unverifiable',
});

/** Resolves the package's location AND verifies it: the configured `path` is only a locator, and
 * an upstream repo can move or replace what sits there at any time. Without this check `resolve`
 * would hand the agent whatever occupies the old path — producing no error, just a confidently
 * wrong answer. See `resolve-verify.ts` for the ordering and its reasons.
 *
 * `checkoutManaged: false` short-circuits it: there is no point verifying a location inside a
 * checkout that is not the one this ref names. */
const packageDataFor = async (opts: {
  checkoutDir: string;
  checkoutManaged: boolean;
  checkoutReason: string;
  configuredPath: string;
  home: RefsHome;
  key: RefKey;
  packageName: string;
}): Promise<ResolvePackage> => {
  if (!opts.checkoutManaged) {
    return unverifiedPackage(opts.packageName, opts.checkoutReason);
  }
  const outcome = await verifyPackageLocation(opts);
  // Gated on the VERDICT, not on whether a path came back. `unverifiable` keeps its path — a
  // containment rejection, an incomplete scan and lock contention all produce one — and reading a
  // manifest there attaches another package's declarations to the one that was asked for. That is
  // the failure verification exists to prevent, reintroduced one field along.
  const identified = outcome.status === 'verified' || outcome.status === 'relocated';
  const entryPoints =
    identified && outcome.path !== null
      ? await readEntryPoints(join(opts.checkoutDir, outcome.path), opts.packageName)
      : undefined;
  return {
    ...(outcome.candidates === undefined ? {} : { candidates: outcome.candidates }),
    ...(outcome.configuredPath === undefined ? {} : { configured_path: outcome.configuredPath }),
    ...(entryPoints === undefined ? {} : { entry_points: entryPoints }),
    // eslint-disable-next-line unicorn/no-null -- cross-process JSON contract requires null
    local_path: outcome.path === null ? null : join(opts.checkoutDir, outcome.path),
    name: opts.packageName,
    path: outcome.path,
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
    status: outcome.status,
  };
};

// `verified` stays silent: the common case reads exactly as it did before verification existed.
// Every other status gets a line, because it changes what the returned path MEANS — and a caller
// that cannot see that difference is exactly the failure this feature exists to prevent.
/** Every target a declaration names, flattened — for COUNTING and for naming the ones that exist,
 * never for resolution. The structure that decides resolution stays in the JSON. */
const targetsOf = (node: TargetNode): { observed: string; target: string }[] => {
  if (node.kind === 'target') {
    return [{ observed: node.observed, target: node.target }];
  }
  if (node.kind === 'alternatives') {
    return node.alternatives.flatMap((item) => targetsOf(item));
  }
  return node.kind === 'conditions'
    ? node.branches.flatMap((branch) => targetsOf(branch.value))
    : [];
};

const PRESENT_SHOWN = 3;

/** What a human wants from a declaration in a SOURCE checkout: which declared files are actually
 * there. Usually none — nothing is built — and saying so is the useful half, because it stops the
 * reader chasing a `dist/` that this checkout never had.
 *
 * Deliberately not a resolution, and deliberately not a defect: an absent target says what is in
 * this checkout and nothing about the package. */
/** The summary for a declaration where nothing was found present.
 *
 * "None is present" is a claim about every target, and it is only true of the ones that were
 * actually inspected. A pattern is never probed and an unreadable target was never seen, so
 * folding those into an absence would report a fact about something nobody looked at. */
const nothingPresentLine = (targets: readonly { observed: string }[]): string[] => {
  if (targets.length === 0) {
    return [];
  }
  const uninspected = targets.filter(
    (target) => target.observed === 'not_checked' || target.observed === 'unverifiable',
  ).length;
  const absent = targets.length - uninspected;
  const note = uninspected === 0 ? '' : `, ${uninspected} not inspected`;
  return absent === 0
    ? [`entry points: none of the ${targets.length} declared target(s) was inspected`]
    : [`entry points: ${absent} declared target(s) absent here${note}`];
};

const entryPointLines = (entries: EntryPoints): string[] => {
  if (entries.status !== 'complete') {
    return [`entry points: could not be read (${entries.reason ?? 'unknown'})`];
  }
  const targets = entries.entries.flatMap((entry) => targetsOf(entry.value));
  // A directory counts as found: an `exports` target may legitimately name one, and calling it
  // absent would be wrong in the same way as calling a pattern absent.
  const present = targets.filter(
    (target) => target.observed === 'file' || target.observed === 'directory',
  );
  if (present.length === 0) {
    return nothingPresentLine(targets);
  }
  const shown = present.slice(0, PRESENT_SHOWN).map((target) => target.target);
  const more = present.length - shown.length;
  return [`entry points present: ${shown.join(', ')}${more === 0 ? '' : ` (+${more} more)`}`];
};

const packageLines = (pkg: ResolvePackage): string[] => [
  `package: ${pkg.name}`,
  `package path: ${pkg.local_path ?? '(unknown)'}`,
  ...(pkg.status === 'verified' ? [] : [`package status: ${pkg.status}`]),
  ...(pkg.configured_path === undefined ? [] : [`configured path: ${pkg.configured_path}`]),
  ...(pkg.candidates === undefined ? [] : [`candidates: ${pkg.candidates.join(', ')}`]),
  ...(pkg.reason === undefined ? [] : [`reason: ${pkg.reason}`]),
  ...(pkg.entry_points === undefined ? [] : entryPointLines(pkg.entry_points)),
];

export { packageDataFor, packageLines };
export type { ResolvePackage };
