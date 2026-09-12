import type {
  PackageEntry,
  Proposal,
  RefEntry,
  RefKey,
  TagFormat,
  WorkspacePackage,
} from '@kaisers-io/refs-core';
import { shellQuote } from '../shell-quote.ts';
import { validationError } from '@kaisers-io/refs-core';

// `packages`/`tag_format` shaping between the proposal shape (partial, machine-detected) and the
// config shape (full `zPackageEntry`s, `zRefEntry`). See `add-source.ts` for source
// resolution/guards and `add-proposal-io.ts` for proposal-file/stdin loading.

const ROOT_PACKAGE_PATH = '.';

type ProposalPackages = Proposal['packages'];
type ProposalPackageEntry = ProposalPackages[string];

/** Detection carries identity and nothing else (`WorkspacePackage` in core), so a proposal entry
 * is a path. A manifest's own `description` deliberately does not survive the scan: it is prose
 * from an unvetted repository, and everything in this file ends up in `config.toml`. Every
 * description in a finalized entry is therefore written by someone who read the source — a worker
 * on the two-phase path, or the caller's own `--description` for the root. */
const toProposalEntry = (pkg: WorkspacePackage): ProposalPackageEntry => ({ path: pkg.path });

/** Shapes the proposal's `packages` record: real workspace detection wins when it finds anything;
 * otherwise, for an `npm:<pkg>` source, seeds a single entry for the package itself — at its
 * packument-declared `directory` when known, else `path: '.'` (a single-package repo); a plain git
 * url with no detected packages gets an empty record (→ no packages table at finalize time). */
/** Detection minus the repository root — the packages a workspace declaration actually selected.
 *
 * The distinction matters in one place and matters a lot there: a root is found by looking, not by
 * being declared, so "detection found something" must not become true merely because a repository
 * names its own root. */
const workspaceMembersOf = (detected: readonly WorkspacePackage[]): WorkspacePackage[] =>
  detected.filter((pkg) => pkg.path !== ROOT_PACKAGE_PATH);

const rootOf = (detected: readonly WorkspacePackage[]): WorkspacePackage | undefined =>
  detected.find((pkg) => pkg.path === ROOT_PACKAGE_PATH);

/** The repository root as a proposal entry, if detection found a named one.
 *
 * No collision handling here: `detectWorkspacePackagesDetailed` already drops a root whose name a
 * member claims, so that a MOVED member still resolves against the same scan. Repeating the rule
 * at this layer would be a second place for it to drift. */
const rootEntryOf = (
  detected: readonly WorkspacePackage[],
): Record<string, ProposalPackageEntry> => {
  const root = rootOf(detected);
  return root === undefined ? {} : { [root.name]: toProposalEntry(root) };
};

const buildProposalPackages = (
  detected: readonly WorkspacePackage[],
  npmDirectory: string | undefined,
  npmPkgName: string | undefined,
): Record<string, ProposalPackageEntry> => {
  const members = workspaceMembersOf(detected);
  const rootEntry = rootEntryOf(detected);
  if (members.length > 0) {
    return {
      ...rootEntry,
      ...Object.fromEntries(members.map((pkg) => [pkg.name, toProposalEntry(pkg)])),
    };
  }
  // No member was selected — an empty `packages/*`, or a pattern the classifier does not support.
  // The npm locator is what the caller asked for and must survive that: seeding only the root
  // here would silently drop the package named in `npm:<pkg>`, which is the whole reason the
  // source was given. The root rides along when it named itself.
  if (npmPkgName !== undefined) {
    // The locator simply wins under its own name. It used to be preferred only at a DIFFERENT
    // path, so that a packument naming the package detection had already read could not displace
    // that manifest's own description; with no description to preserve, both branches now produce
    // the same entry and the distinction is gone.
    return { ...rootEntry, [npmPkgName]: { path: npmDirectory ?? ROOT_PACKAGE_PATH } };
  }
  return rootEntry;
};

/** Only called once `requireDescribablePackages` has already rejected every entry but the
 * repository root, whose description `withRootDescription` has just filled in from the caller's
 * own `--description` — `pkg.description` is therefore never actually `undefined` here, but the
 * proposal shape (`ProposalPackageEntry`) still types it optional, so the empty-string fallback is
 * purely a type-level escape hatch, never a real value in practice. */
const toFinalPackageEntry = (pkg: ProposalPackageEntry): PackageEntry => {
  const description = pkg.description ?? '';
  if (pkg.tag_format === undefined) {
    return { description, path: pkg.path };
  }
  return { description, path: pkg.path, tag_format: pkg.tag_format };
};

/** An empty `packages` record means a plain reference repo — omitted entirely (`undefined`), not
 * `{}`. Callers (the `--description` one-shot flow) must call `requireDescribablePackages` on the
 * same `proposalPackages` first: unlike the `--proposal` flow (whose packages already went through
 * human review as full `zPackageEntry`s), a one-shot has no per-package description input at all,
 * so any package other than the root would otherwise silently finalize with an empty description
 * string. */
const buildFinalPackages = (
  proposalPackages: Record<string, ProposalPackageEntry>,
  opts: { refDescription: string; rootPackageName?: string },
): Record<string, PackageEntry> | undefined => {
  const entries = Object.entries(proposalPackages);
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(
    entries.map(([name, pkg]) => [
      name,
      toFinalPackageEntry(
        name === opts.rootPackageName ? withRootDescription(pkg, opts.refDescription) : pkg,
      ),
    ]),
  );
};

/** The name under which the repository root is actually REGISTERED, if it is — read from the
 * record that was BUILT, not from raw detection.
 *
 * That distinction is the whole point. Three different defects came from answering this question
 * out of `detected`: a root dropped because a member claimed its name, a root displaced by the
 * `npm:` fallback carrying the packument's own directory, and a root that was never registered at
 * all. Each one kept handing the root's description exemption to whatever entry ended up under
 * that name — so a child package with no description of its own silently received text written
 * about the repository, which is exactly the substitution `buildDescriptionRef`'s rule exists to
 * prevent.
 *
 * Checking the registered path settles all three at once, and the one case it deliberately still
 * exempts is right: an `npm:` entry that landed at `.` under the root's own name is that root —
 * same directory, same manifest, same package. */
const registeredRootName = (
  detected: readonly WorkspacePackage[],
  packages: Record<string, ProposalPackageEntry>,
): string | undefined => {
  const [rootName] = Object.keys(rootEntryOf(detected));
  if (rootName === undefined) {
    return undefined;
  }
  return packages[rootName]?.path === ROOT_PACKAGE_PATH ? rootName : undefined;
};

/** The repository root's description is the REF's, and only the root's.
 *
 * `buildDescriptionRef`'s rule — the one-shot `--description` is the ref's own text, never a
 * per-package fallback — exists because a child package is a different thing from the repository
 * and deserves its own words. The root is not a different thing: it is that repository, at that
 * path, so the text the caller just typed about the repository describes it exactly. It is also
 * the only description on this path that anyone wrote deliberately: nothing else here has one. */
const withRootDescription = (
  pkg: ProposalPackageEntry,
  refDescription: string,
): ProposalPackageEntry => ({ ...pkg, description: refDescription });

/** Lists (sorted) every detected package the one-shot cannot describe — all of them except the
 * repository root. Detection reads a manifest for identity only, so no entry arrives carrying a
 * description, and `--description` is one string about the repository rather than per-package
 * input; see `requireDescribablePackages`. */
const packagesNeedingDescription = (
  proposalPackages: Record<string, ProposalPackageEntry>,
  rootPackageName: string | undefined,
): string[] =>
  Object.keys(proposalPackages)
    .filter((name) => name !== rootPackageName)
    .toSorted();

/** Fails closed — before any write — when the `--description` one-shot detected any package other
 * than the repository root, naming ALL of them (the repo's established "list every offending key"
 * precedent — see `resolve.ts`'s multi-ref ambiguity message) rather than just the first. Validates
 * before finalize: called from `add.ts#buildDescriptionRef` before `finalizeRef` ever runs, so a
 * rejection here writes nothing to config or state (the dry-run's checkout is already on disk).
 *
 * The suggested commands carry the caller's own `source`, shell-quoted, rather than a `<source>`
 * placeholder: a printed command that cannot be run as printed is a bug here (`CLAUDE.md`). They
 * name the REF's description too — a dry-run proposal carries `description: ''`, which
 * `zFinalProposal` rejects, so "describe every package" alone would send the reader into a second
 * failure. Each runnable command is on its own indented line; the prose between them never is.
 *
 * The list comes LAST, unlike `resolve.ts`'s ambiguity message, and for the opposite reason: there
 * every name is a choice the reader has to make between, so the names ARE the message. Here every
 * name leads to the same two commands, and a real monorepo contributes a hundred of them — so the
 * part worth reading if anything truncates is the recovery, not the inventory. */
const requireDescribablePackages = (
  proposalPackages: Record<string, ProposalPackageEntry>,
  source: string,
  rootPackageName?: string,
): void => {
  const undescribed = packagesNeedingDescription(proposalPackages, rootPackageName);
  if (undescribed.length === 0) {
    return;
  }
  throw validationError(
    'refs add --description cannot describe a package: it has one description, about the ' +
      'repository. Run the two-phase flow instead:\n' +
      `  refs add ${shellQuote(source)} --dry-run --json > proposal.json\n` +
      "Fill in the ref's own description and one for every package below, written from its own " +
      'source, then:\n' +
      '  refs add --proposal proposal.json\n' +
      `packages needing a description: ${undescribed.join(', ')}`,
  );
};

/** The `--proposal <file>` flow's packages already went through human review as full
 * `zPackageEntry`s (`zFinalProposal` guarantees non-empty descriptions) — only the empty→undefined
 * "no packages table" collapse is still needed here. */
const finalProposalPackages = (
  packages: Record<string, PackageEntry>,
): Record<string, PackageEntry> | undefined => {
  if (Object.keys(packages).length === 0) {
    return undefined;
  }
  return packages;
};

/** A `null` `tag_format_candidate` means dry-run detection found no reliable tag format, and that
 * survives finalize as an absent `tag_format`. Finalize used to reject it, which left whoever ran
 * `refs add` two options for a repository that simply has no tags: invent a convention, or give up.
 * The invented one then read as observed fact to every later agent. `refs tag` reports the absence
 * instead; nothing else consults the field. */
type FinalizedRefInput = {
  default_branch: string;
  description: string;
  key: RefKey;
  packages?: Record<string, PackageEntry>;
  tag_format?: TagFormat;
  url: string;
};

// Built key-by-key rather than spread, because `exactOptionalPropertyTypes` distinguishes an absent
// key from one set to `undefined`, and TOML has no way to write the latter.
const buildRefEntry = (ref: FinalizedRefInput): RefEntry => {
  const entry: RefEntry = {
    default_branch: ref.default_branch,
    description: ref.description,
    url: ref.url,
  };
  if (ref.packages !== undefined) {
    entry.packages = ref.packages;
  }
  if (ref.tag_format !== undefined) {
    entry.tag_format = ref.tag_format;
  }
  return entry;
};

export {
  buildFinalPackages,
  buildProposalPackages,
  buildRefEntry,
  finalProposalPackages,
  packagesNeedingDescription,
  registeredRootName,
  requireDescribablePackages,
};
export type { FinalizedRefInput };
