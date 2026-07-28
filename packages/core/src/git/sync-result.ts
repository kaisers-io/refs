// Pure, `Runner`-independent assembly of `syncRef`'s (git/repo.ts) return value: status
// classification (fresh/updated/restored) and warning aggregation.

type SyncResultShas = {
  oldSha: string;
  newSha: string;
};

type SyncStatus = 'updated' | 'fresh' | 'restored';

type BuiltSyncResult = {
  status: SyncStatus;
  branchRenamedTo?: string;
  oldSha: string;
  newSha: string;
  warning?: string;
};

type BuildSyncResultOpts = {
  shas: SyncResultShas;
  dirty: boolean;
  branchRenamedTo?: string;
  setHeadWarning?: string;
};

// A restore discards local changes even though the sync succeeded — surfaced as a warning.
const RESTORED_WARNING =
  'checkout had local changes (managed checkouts are read-only) — discarded and restored to the remote state';

const NO_WARNINGS = 0;
const EXCERPT_MAX_LENGTH = 200;
const FIRST_LINE_INDEX = 0;

/** Best-effort one-line summary of a failed command's output, for a `SyncResult` warning. */
const excerpt = (result: { stdout: string; stderr: string; exitCode: number }): string => {
  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
  const firstLine = detail.split('\n')[FIRST_LINE_INDEX] ?? detail;
  if (firstLine.length <= EXCERPT_MAX_LENGTH) {
    return firstLine;
  }
  return `${firstLine.slice(FIRST_LINE_INDEX, EXCERPT_MAX_LENGTH)}…`;
};

const computeStatus = (shas: SyncResultShas, dirty: boolean): SyncStatus => {
  if (dirty) {
    return 'restored';
  }
  if (shas.oldSha === shas.newSha) {
    return 'fresh';
  }
  return 'updated';
};

const computeWarning = (dirty: boolean, setHeadWarning?: string): string | undefined => {
  const warnings: string[] = [];
  if (dirty) {
    warnings.push(RESTORED_WARNING);
  }
  if (setHeadWarning !== undefined) {
    warnings.push(setHeadWarning);
  }
  if (warnings.length === NO_WARNINGS) {
    return undefined;
  }
  return warnings.join(' | ');
};

// Assembles `syncRef`'s return value: dirty → 'restored' + warning, else 'fresh'/'updated' by HEAD
// movement. A failed `origin/HEAD` refresh (`setHeadWarning`) is merged alongside any restore
// warning rather than replacing it — both can legitimately fire in the same sync.
const buildSyncResult = (opts: BuildSyncResultOpts): BuiltSyncResult => {
  const { branchRenamedTo, dirty, setHeadWarning, shas } = opts;
  const result: BuiltSyncResult = { ...shas, status: computeStatus(shas, dirty) };
  if (branchRenamedTo !== undefined) {
    result.branchRenamedTo = branchRenamedTo;
  }
  const warning = computeWarning(dirty, setHeadWarning);
  if (warning !== undefined) {
    result.warning = warning;
  }
  return result;
};

// Reshapes `resolveSyncBranch`'s result into `buildSyncResult`'s input — kept as a separate step
// so `syncRef` (repo.ts) doesn't have to: `exactOptionalPropertyTypes` forbids assigning
// `undefined` into an object literal's optional slots, hence the `if`s below.
const toBuildSyncResultOpts = (
  syncBranch: { branchRenamedTo?: string; warning?: string },
  dirty: boolean,
  shas: SyncResultShas,
): BuildSyncResultOpts => {
  const built: BuildSyncResultOpts = { dirty, shas };
  if (syncBranch.branchRenamedTo !== undefined) {
    built.branchRenamedTo = syncBranch.branchRenamedTo;
  }
  if (syncBranch.warning !== undefined) {
    built.setHeadWarning = syncBranch.warning;
  }
  return built;
};

export { buildSyncResult, excerpt, toBuildSyncResultOpts };
export type { BuiltSyncResult, SyncStatus };
