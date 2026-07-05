import type {
  PackageEntry,
  Proposal,
  RefEntry,
  RefKey,
  TagFormat,
  WorkspacePackage,
} from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { validationError } from '@kaisers-io/refs-core';

// `packages`/`tag_format` shaping between the proposal shape (partial, machine-detected) and the
// config shape (full `zPackageEntry`s, `zRefEntry`) — split out of `add.ts` purely to keep that
// file under the repo's 300-line oxlint cap. See `add-helpers.ts` for source resolution/guards and
// `add-proposal-io.ts` for proposal-file/stdin loading.

const ROOT_PACKAGE_PATH = '.';
const NO_ITEMS = 0;

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
const buildProposalPackages = (
  detected: readonly WorkspacePackage[],
  npmDirectory: string | undefined,
  npmPkgName: string | undefined,
): Record<string, ProposalPackageEntry> => {
  if (detected.length > NO_ITEMS) {
    return Object.fromEntries(detected.map((pkg) => [pkg.name, toProposalEntry(pkg)]));
  }
  if (npmPkgName !== undefined) {
    return { [npmPkgName]: { path: npmDirectory ?? ROOT_PACKAGE_PATH } };
  }
  return {};
};

const toFinalPackageEntry = (
  pkg: ProposalPackageEntry,
  fallbackDescription: string,
): PackageEntry => {
  const description = pkg.description ?? fallbackDescription;
  if (pkg.tag_format === undefined) {
    return { description, path: pkg.path };
  }
  return { description, path: pkg.path, tag_format: pkg.tag_format };
};

/** Only used by the `--description` one-shot flow: fills any package missing a detected
 * description with the ref's own `--description` text, so the one-shot command never fails
 * `zPackageEntry`'s non-empty-description requirement just because detection found a name/path but
 * no description (see `workspaces.ts`'s deliberately-description-less fixture package). An empty
 * `packages` record means a plain reference repo — omitted entirely (`undefined`), not `{}`. */
const buildFinalPackages = (
  proposalPackages: Record<string, ProposalPackageEntry>,
  fallbackDescription: string,
): Record<string, PackageEntry> | undefined => {
  const entries = Object.entries(proposalPackages);
  if (entries.length === NO_ITEMS) {
    return undefined;
  }
  return Object.fromEntries(
    entries.map(([name, pkg]) => [name, toFinalPackageEntry(pkg, fallbackDescription)]),
  );
};

/** The `--proposal <file>` flow's packages already went through human review as full
 * `zPackageEntry`s (`zFinalProposal` guarantees non-empty descriptions) — only the empty→undefined
 * "no packages table" collapse is still needed here. */
const finalProposalPackages = (
  packages: Record<string, PackageEntry>,
): Record<string, PackageEntry> | undefined => {
  if (Object.keys(packages).length === NO_ITEMS) {
    return undefined;
  }
  return packages;
};

/** A `null` `tag_format_candidate` means dry-run detection found no reliable tag format — finalize
 * (either `--proposal` or `--description`) needs a real one to satisfy `zRefEntry.tag_format`
 * (required, unlike the proposal's nullable candidate): either the human filled it in in the
 * proposal file, or the source repo really has none and finalizing must be rejected. */
const requireTagFormat = (candidate: TagFormat | null): TagFormat => {
  if (candidate === null) {
    throw validationError(
      "tag_format_candidate must be set to a valid tag format (containing '{version}') " +
        'before finalizing — edit the proposal and provide one, or add the ref manually',
    );
  }
  return candidate;
};

interface FinalizedRefInput {
  default_branch: string;
  description: string;
  key: RefKey;
  packages?: Record<string, PackageEntry>;
  tag_format: TagFormat;
  url: string;
}

const buildRefEntry = (ref: FinalizedRefInput): RefEntry => {
  if (ref.packages === undefined) {
    return {
      default_branch: ref.default_branch,
      description: ref.description,
      tag_format: ref.tag_format,
      url: ref.url,
    };
  }
  return {
    default_branch: ref.default_branch,
    description: ref.description,
    packages: ref.packages,
    tag_format: ref.tag_format,
    url: ref.url,
  };
};

export {
  buildFinalPackages,
  buildProposalPackages,
  buildRefEntry,
  finalProposalPackages,
  requireTagFormat,
};
export type { FinalizedRefInput, ProposalPackageEntry };
