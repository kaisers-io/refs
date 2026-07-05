import type { Config, RefsHome, State } from '@kaisers-io/refs-core';
import {
  isEnoent,
  isGitCheckout,
  readState,
  zState,
  // eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
} from '@kaisers-io/refs-core';
import type { CheckResult } from './doctor-types.ts';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';

// `orphans` — a checkout directory under `sources/` that is not (or no longer) a configured ref.
// Split out of `doctor.ts` purely to keep that file under the repo's 300-line oxlint cap. Never
// deletes anything (YAGNI per the task brief): a fresh `pending_proposal_at` (a dry-run clone still
// awaiting `refs add --proposal`/`--description`) reports as `pending add`; anything else reports
// as a true orphan with the exact `rm -rf <path>` a human/agent can run by hand.

const EMPTY_LENGTH = 0;

/** Never throws: `readState` is already self-healing for a corrupt/malformed state file, but an
 * unexpected fs fault (e.g. permission denied) still propagates from it — caught here too, since
 * `doctor` must run every check regardless of what it finds. */
const loadStateSafely = async (home: RefsHome): Promise<State> => {
  try {
    return await readState(home);
  } catch {
    return zState.parse({});
  }
};

const listSubdirNames = async (dir: string): Promise<string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }
};

/** Recursively walks `dir`, returning the segment path (relative to `sources/`) of every git
 * checkout found. A directory containing `.git` ends that branch of the walk rather than being
 * descended into further — a checkout's own internal folders are never mistaken for nested
 * checkouts. Recursive (mirroring `remove.ts#pruneEmptyParents`'s "recursive rather than an
 * imperative loop" discipline) so no single function's statement count grows with tree depth. */
const findCheckoutSegments = async (
  dir: string,
  segments: readonly string[],
): Promise<string[][]> => {
  if (isGitCheckout(dir)) {
    return [[...segments]];
  }
  const names = await listSubdirNames(dir);
  const nested = await Promise.all(
    names.map((name) => findCheckoutSegments(join(dir, name), [...segments, name])),
  );
  return nested.flat();
};

const TWENTY_FOUR_HOURS_MS = 86_400_000;

const isFreshPendingProposal = (state: State, key: string, now: number): boolean => {
  const pendingAt = state.refs[key]?.pending_proposal_at;
  if (pendingAt === undefined) {
    return false;
  }
  return now - Date.parse(pendingAt) < TWENTY_FOUR_HOURS_MS;
};

interface OrphanCandidate {
  dest: string;
  key: string;
}

const classifyOrphan = (candidate: OrphanCandidate, state: State, now: number): string => {
  if (isFreshPendingProposal(state, candidate.key, now)) {
    return `${candidate.key}: pending add`;
  }
  return `${candidate.key}: orphan — remove with: rm -rf ${candidate.dest}`;
};

const toCandidate = (home: RefsHome, segments: readonly string[]): OrphanCandidate => ({
  dest: join(home.sourcesDir, ...segments),
  key: segments.join('/'),
});

const checkOrphans = async (home: RefsHome, config: Config, state: State): Promise<CheckResult> => {
  const segmentsList = await findCheckoutSegments(home.sourcesDir, []);
  const candidates = segmentsList
    .map((segments) => toCandidate(home, segments))
    .filter((candidate) => !Object.hasOwn(config.refs, candidate.key));
  if (candidates.length === EMPTY_LENGTH) {
    return { detail: 'no orphaned checkouts under sources/', name: 'orphans', status: 'ok' };
  }
  const now = Date.now();
  const messages = candidates.map((candidate) => classifyOrphan(candidate, state, now));
  return { detail: messages.join('; '), name: 'orphans', status: 'warn' };
};

export { checkOrphans, loadStateSafely };
