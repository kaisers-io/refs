import type { Proposal, TagFormat, WorkspaceScan } from '@kaisers-io/refs-core';
import { detectTagFormatForVersion, tagFormatNamesPackage } from '@kaisers-io/refs-core';

// Which tag format a dry-run proposes, at both levels. The counted answer (`detectTagFormat`) is
// still what a repository gets when nothing here can anchor; this decides when there is better
// evidence than a count.
//
// The evidence is a version the checkout itself declares for a package. A tag that ends in exactly
// that version is a tag that package's release wrote, and its shape is the format — see
// `detectTagFormatForVersion` in core for what it accepts and why.

const ROOT_PACKAGE_PATH = '.';

type ProposalPackageEntry = Proposal['packages'][string];

type Anchor = {
  scan: WorkspaceScan;
  tags: readonly string[];
};

/** The format the repository tags `name` with, anchored on the version the manifest at `path`
 * declares. `null` whenever there is no version to anchor on — which is every repository that
 * ships no `package.json` at all, and every package whose declared version was never tagged.
 *
 * The name comes from the caller rather than from the scan, because it is the name the package is
 * REGISTERED under that a tag has to carry: the `npm:<pkg>` fallback can register a locator's name
 * at a path whose manifest declares a different one, and checking the other name would be checking
 * the wrong thing. */
const anchoredFormat = (path: string, name: string, anchor: Anchor): TagFormat | null => {
  const version = anchor.scan.versions[path];
  // eslint-disable-next-line unicorn/no-null -- matches `detectTagFormatForVersion`'s own return
  return version === undefined ? null : detectTagFormatForVersion(anchor.tags, version, name);
};

/** The ref's own `tag_format` candidate: anchored on the REPOSITORY ROOT's package, else the
 * counted answer this has always returned.
 *
 * The root and nothing else, deliberately. The ref-level format is what every package without its
 * own inherits (`refs tag` reads `package.tag_format ?? ref.tag_format`), so it is a claim about
 * the repository rather than about one member of it — and anchoring it on, say, the package named
 * in `npm:<pkg>` would hand that package's convention to every sibling that has no override.
 * Measured: in a repository that tags `addon@{version}` for one package and `v{version}` for the
 * rest, that is wrong for the rest. A root package IS the repository at that path, so its
 * convention is the repository's; a member's belongs on the member (`withTagFormats`).
 *
 * `kysely-org/kysely` is what this is for: its root manifest is the published `kysely`, and
 * counting named the bare `{version}` of its older releases, which no current release carries. */
const refTagFormat = (opts: {
  counted: TagFormat | null;
  scan: WorkspaceScan;
  tags: readonly string[];
}): TagFormat | null => {
  const root = opts.scan.packages.find((pkg) => pkg.path === ROOT_PACKAGE_PATH);
  if (root === undefined) {
    return opts.counted;
  }
  return (
    anchoredFormat(ROOT_PACKAGE_PATH, root.name, { scan: opts.scan, tags: opts.tags }) ??
    opts.counted
  );
};

/** One proposal entry, carrying its own `tag_format` only when the repository tags it under its own
 * NAME and differently from the ref.
 *
 * Equal to the ref's is not worth writing: `refs tag` reads `package.tag_format ?? ref.tag_format`,
 * so the entry would restate what it already inherits — and in a repository whose packages all
 * release under one `v{version}`, every entry would carry a copy of it.
 *
 * The name check is what keeps an unrelated tag off an entry — see `tagFormatNamesPackage`. It
 * applies here and not to the ref's own format, because a repository-wide tag IS evidence about the
 * repository and is not evidence about one package inside it. */
const withFormat = (opts: {
  entry: ProposalPackageEntry;
  format: TagFormat | null;
  name: string;
  refFormat: TagFormat | null;
}): ProposalPackageEntry =>
  opts.format === null ||
  opts.format === opts.refFormat ||
  !tagFormatNamesPackage(opts.format, opts.name)
    ? opts.entry
    : { ...opts.entry, tag_format: opts.format };

/** Every proposal entry, each given its own `tag_format` where the repository's tags show one.
 *
 * A monorepo that tags `pkg@{version}` needs this: one ref-level format cannot be right for forty
 * packages, and before this the one it got was whichever package had tagged most often. */
const withTagFormats = (opts: {
  packages: Record<string, ProposalPackageEntry>;
  refFormat: TagFormat | null;
  scan: WorkspaceScan;
  tags: readonly string[];
}): Record<string, ProposalPackageEntry> => {
  const anchor: Anchor = { scan: opts.scan, tags: opts.tags };
  return Object.fromEntries(
    Object.entries(opts.packages).map(([name, entry]) => [
      name,
      withFormat({
        entry,
        format: anchoredFormat(entry.path, name, anchor),
        name,
        refFormat: opts.refFormat,
      }),
    ]),
  );
};

export { refTagFormat, withTagFormats };
