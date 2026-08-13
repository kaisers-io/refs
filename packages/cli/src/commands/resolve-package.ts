import type { RefKey, RefsHome } from '@kaisers-io/refs-core';
import type { PackageStatus } from './resolve-verify.ts';
import { join } from 'node:path';
import { verifyPackageLocation } from './resolve-verify.ts';

// The `package` half of `refs resolve`'s payload: its JSON shape, how it is produced (which means
// verifying the configured location, not just joining it), and how it renders for a human.
// Separate from `resolve.ts` so the routing logic there — already dense with four-step precedence
// rules — stays readable.

type ResolvePackage = {
  candidates?: string[];
  configured_path?: string;
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

/** Resolves the package's location AND verifies it: the configured `path` is only a locator, and
 * an upstream repo can move or replace what sits there at any time. Without this check `resolve`
 * would hand the agent whatever occupies the old path — producing no error, just a confidently
 * wrong answer. See `resolve-verify.ts` for the ordering and its reasons. */
const packageDataFor = async (opts: {
  checkoutDir: string;
  configuredPath: string;
  home: RefsHome;
  key: RefKey;
  packageName: string;
}): Promise<ResolvePackage> => {
  const outcome = await verifyPackageLocation(opts);
  return {
    ...(outcome.candidates === undefined ? {} : { candidates: outcome.candidates }),
    ...(outcome.configuredPath === undefined ? {} : { configured_path: outcome.configuredPath }),
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
const packageLines = (pkg: ResolvePackage): string[] => [
  `package: ${pkg.name}`,
  `package path: ${pkg.local_path ?? '(unknown)'}`,
  ...(pkg.status === 'verified' ? [] : [`package status: ${pkg.status}`]),
  ...(pkg.configured_path === undefined ? [] : [`configured path: ${pkg.configured_path}`]),
  ...(pkg.candidates === undefined ? [] : [`candidates: ${pkg.candidates.join(', ')}`]),
  ...(pkg.reason === undefined ? [] : [`reason: ${pkg.reason}`]),
];

export { packageDataFor, packageLines };
export type { ResolvePackage };
