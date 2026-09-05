import type {
  PackageEntry,
  Proposal,
  RefEntry,
  RefKey,
  TagFormat,
  WorkspacePackage,
} from '@kaisers-io/refs-core';
import { validationError } from '@kaisers-io/refs-core';

// `packages`/`tag_format` shaping between the proposal shape (partial, machine-detected) and the
// config shape (full `zPackageEntry`s, `zRefEntry`). See `add-source.ts` for source
// resolution/guards and `add-proposal-io.ts` for proposal-file/stdin loading.

const ROOT_PACKAGE_PATH = '.';

type ProposalPackages = Proposal['packages'];
type ProposalPackageEntry = ProposalPackages[string];

const toProposalEntry = (pkg: WorkspacePackage): ProposalPackageEntry => {
  if (pkg.description === undefined) {
    return { path: pkg.path };
  }
  return { description: pkg.description, path: pkg.path };
};

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

/** The root, dropped when a workspace member already claims its name.
 *
 * Detection deduplicates by path, so both survive it; the record below is keyed by name and would
 * keep whichever came last. Not hypothetical — `@remix-run/react-router` is a real root name in a
 * repository that also publishes `react-router` from `packages/`. The member wins because it is
 * the more specific thing and because it is what was registered before roots were looked at: a
 * collision costs that repository nothing it had, rather than turning `refs add` into an error for
 * a shape that used to work. */
const rootEntryUnlessClaimed = (
  detected: readonly WorkspacePackage[],
): Record<string, ProposalPackageEntry> => {
  const root = rootOf(detected);
  if (root === undefined) {
    return {};
  }
  const claimed = workspaceMembersOf(detected).some((pkg) => pkg.name === root.name);
  return claimed ? {} : { [root.name]: toProposalEntry(root) };
};

const buildProposalPackages = (
  detected: readonly WorkspacePackage[],
  npmDirectory: string | undefined,
  npmPkgName: string | undefined,
): Record<string, ProposalPackageEntry> => {
  const members = workspaceMembersOf(detected);
  const rootEntry = rootEntryUnlessClaimed(detected);
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
    return { ...rootEntry, [npmPkgName]: { path: npmDirectory ?? ROOT_PACKAGE_PATH } };
  }
  return rootEntry;
};

/** Only called once `requireAllDescribed` has already guaranteed every package carries a detected
 * NON-EMPTY description (see `isMissingDescription`) — `pkg.description` is therefore never
 * actually `undefined` here, but the proposal shape (`ProposalPackageEntry`) still types it
 * optional, so the empty-string fallback is purely a type-level escape hatch, never a real value
 * in practice. */
const toFinalPackageEntry = (pkg: ProposalPackageEntry): PackageEntry => {
  const description = pkg.description ?? '';
  if (pkg.tag_format === undefined) {
    return { description, path: pkg.path };
  }
  return { description, path: pkg.path, tag_format: pkg.tag_format };
};

/** An empty `packages` record means a plain reference repo — omitted entirely (`undefined`), not
 * `{}`. Callers (the `--description` one-shot flow) must call `requireAllDescribed` on the same
 * `proposalPackages` first: unlike the `--proposal` flow (whose packages already went through
 * human review as full `zPackageEntry`s), a one-shot has no per-package description input, so any
 * package still missing one at this point would otherwise silently finalize with an empty
 * description string. */
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

/** An absent description AND an empty-string one both count as missing, mirroring
 * `zPackageEntry.description`'s `min(1)` rule exactly (no whitespace-trimming beyond that):
 * core's `extractPackageDescription` passes ANY manifest string through — including the `""` that
 * `npm init -y` scaffolds — so an empty string here would otherwise slip past the guard only to
 * die later in finalize's schema validation with exactly the degraded generic error the guard
 * exists to prevent. */
const isMissingDescription = (pkg: ProposalPackageEntry): boolean =>
  pkg.description === undefined || pkg.description === '';

/** The name of the detected workspace root, if the repository's root manifest declares one.
 *
 * Identified by NAME rather than by path, and that distinction is load-bearing: the `npm:` fallback
 * also registers at `.`, for a published single-package repo whose own description is its own
 * business. Only an entry that workspace detection found at the root is the repository itself. */
const rootPackageNameOf = (detected: readonly WorkspacePackage[]): string | undefined =>
  detected.find((pkg) => pkg.path === ROOT_PACKAGE_PATH)?.name;

/** The root package's description falls back to the REF's, and only the root's.
 *
 * `buildDescriptionRef`'s rule — the one-shot `--description` is the ref's own text, never a
 * per-package fallback — exists because a child package is a different thing from the repository
 * and deserves its own words. The root is not a different thing: it is that repository, at that
 * path. Almost no workspace root carries a `description` (they are private and unpublished), so
 * without this the one-shot flow would start refusing nearly every monorepo and forcing the
 * two-phase proposal on it — a regression on the common path in exchange for asking someone to
 * restate what they had just typed. A manifest that DOES describe itself keeps its own text. */
const withRootDescription = (
  pkg: ProposalPackageEntry,
  refDescription: string,
): ProposalPackageEntry =>
  isMissingDescription(pkg) ? { ...pkg, description: refDescription } : pkg;

/** Lists package names (sorted) missing a detected description — the `--description` one-shot has
 * no per-package description input (unlike the two-phase `--proposal` flow's human review step),
 * so it cannot silently fill these in; see `requireAllDescribed`. */
const packagesMissingDescription = (
  proposalPackages: Record<string, ProposalPackageEntry>,
  rootPackageName: string | undefined,
): string[] =>
  Object.entries(proposalPackages)
    .filter(([name, pkg]) => isMissingDescription(pkg) && name !== rootPackageName)
    .map(([name]) => name)
    .toSorted();

/** Fails closed — before any write — when the `--description` one-shot's detected packages include
 * any missing a description, naming ALL of them (the repo's established "list every offending key"
 * precedent — see `resolve.ts`'s multi-ref ambiguity message) rather than just the first. Validates
 * before finalize: called from `add.ts#buildDescriptionRef` before `finalizeRef` ever runs, so a
 * rejection here writes nothing to config or state. */
const requireAllDescribed = (
  proposalPackages: Record<string, ProposalPackageEntry>,
  rootPackageName?: string,
): void => {
  const missing = packagesMissingDescription(proposalPackages, rootPackageName);
  if (missing.length === 0) {
    return;
  }
  throw validationError(
    `packages without a detected description: ${missing.join(', ')} — run the two-phase flow ` +
      'instead: refs add <source> --dry-run --json > proposal.json, fill in the package ' +
      'descriptions, then refs add --proposal proposal.json',
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
  packagesMissingDescription,
  requireAllDescribed,
  rootPackageNameOf,
};
export type { FinalizedRefInput };
