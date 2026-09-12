import { CURRENT_DIR_SEGMENT, normalizeSeparators } from './workspaces-shapes.ts';
import { Minimatch } from 'minimatch';
import { posix } from 'node:path';

// What one recursive pattern decides before any directory is read: how deep a match can sit, which
// paths it selects, and which directories could still hold one. Split from
// `workspaces-recursive.ts` for the 300-line cap — that file walks, this one reads the pattern.

const MANIFEST_FILE = 'package.json';

type PatternPlan = {
  couldHold: (path: string) => boolean;
  maxDepth: number | undefined;
  selects: (path: string) => boolean;
  selectsHidden: boolean;
};

/** The deepest a match can sit under a pattern with no `**`, counted in segments. `undefined`
 * where `**` makes it unbounded. */
const boundedDepthOf = (pattern: string): number | undefined => {
  const segments = normalizeSeparators(pattern).split('/');
  return segments.includes('**') ? undefined : segments.length;
};

const namesHiddenSegment = (pattern: string): boolean =>
  normalizeSeparators(pattern)
    .split('/')
    .some((segment) => segment.startsWith(CURRENT_DIR_SEGMENT));

const depthOf = (relPath: string): number =>
  relPath === CURRENT_DIR_SEGMENT ? 0 : relPath.split('/').length;

const matchersFor = (pattern: string): Pick<PatternPlan, 'couldHold' | 'selects'> => {
  const normalized = normalizeSeparators(pattern);
  const selecting = new Minimatch(`${normalized}/${MANIFEST_FILE}`);
  const descending = new Minimatch(normalized);
  return {
    couldHold: (path) => descending.match(path, true),
    selects: (path) => selecting.match(posix.join(path, MANIFEST_FILE)),
  };
};

const planFor = (pattern: string): PatternPlan => ({
  ...matchersFor(pattern),
  maxDepth: boundedDepthOf(pattern),
  selectsHidden: namesHiddenSegment(pattern),
});

export { depthOf, planFor };
export type { PatternPlan };
