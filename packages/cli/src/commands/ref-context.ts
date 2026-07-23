import type { Config, PackageEntry, RefEntry, RefKey } from '@kaisers-io/refs-core';
import {
  isGitCheckout,
  notFoundError,
  usageError,
  // eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
} from '@kaisers-io/refs-core';

// Shared ref/checkout/package guards and `--limit` parsing for the command layer — extracted so
// no command carries a diverging copy of the same checks (their user-facing message strings are
// part of the CLI contract and must stay identical). Consumed by the investigation helpers
// (`range.ts`, `search.ts`) and the ref commands (`tag.ts`, `show.ts`, `resolve.ts`, `edit-ref.ts`,
// `sync.ts`).

const MIN_LIMIT = 1;

// A ref key produced by `matchRefKey`/`routeQuery` is always one found among
// `Object.keys(config.refs)`, so this lookup can never actually miss — the throw exists purely to
// satisfy `noUncheckedIndexedAccess`, surfaced as an "unexpected" failure by `wrapAction` if it
// ever did.
const requireEntry = (config: Config, key: RefKey): RefEntry => {
  const entry = config.refs[key];
  if (entry === undefined) {
    throw new Error(`internal: matched ref key '${key}' is missing from config.refs`);
  }
  return entry;
};

/** Guards against a configured ref whose checkout directory is missing — first-class state
 * elsewhere (`refs list` reports it, `refs sync` repairs it) that would otherwise surface as a
 * low-level git/cwd error deeper in the command. */
const requireCheckout = (dest: string, key: RefKey): void => {
  if (!isGitCheckout(dest)) {
    throw notFoundError(`checkout for '${key}' is missing — run: refs sync ${key}`);
  }
};

/** The named package's registered entry on `entry`; an unregistered name is a `notFoundError`,
 * exactly like an unresolvable `<ref>` is — mirroring `tag.ts`'s `formatFor`. */
const requirePackage = (entry: RefEntry, key: RefKey, name: string): PackageEntry => {
  const pkg = entry.packages?.[name];
  if (pkg === undefined) {
    throw notFoundError(`no package '${name}' registered on ref '${key}'`);
  }
  return pkg;
};

// Deliberately parsed inside the action rather than via commander's parseArg seam: throwing in a
// parseArg surfaces as a CommanderError, not the standard usage-error envelope — parsing here
// keeps a bad `--limit` on `wrapAction`'s ordinary error-rendering path.
const parsePositiveLimit = (raw: string | undefined, opts: { def: number }): number => {
  if (raw === undefined) {
    return opts.def;
  }
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < MIN_LIMIT) {
    throw usageError(`--limit must be a positive integer, got '${raw}'`);
  }
  return limit;
};

export { parsePositiveLimit, requireCheckout, requireEntry, requirePackage };
