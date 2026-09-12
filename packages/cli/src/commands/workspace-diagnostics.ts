import type { WorkspaceDiagnostic, WorkspaceScan } from '@kaisers-io/refs-core';
import { scanIsReliable } from '@kaisers-io/refs-core';

// How an incomplete workspace scan reads to whoever has to act on it.
//
// Shared rather than owned by one command, because two of them stand down on the same evidence and
// have to name it the same way: `refs add`'s dry-run, whose proposal may then be missing packages,
// and the drift probe, whose unregistered-package pass cannot run. One vocabulary for one fact —
// the same reason `drift-report.ts` exists.

const OBSTACLE_SEPARATOR = ', ';

/** What a diagnostic is ABOUT — a path for most kinds, a pattern for `unsupported_pattern`, and
 * nothing at all for the one kind that describes the repository rather than a place in it.
 *
 * Exhaustive on purpose, with no `default`: a new diagnostic kind then fails to typecheck here
 * until someone decides how it reads, rather than silently rendering as a bare kind name. */
const diagnosticSubject = (diagnostic: WorkspaceDiagnostic): string | undefined => {
  switch (diagnostic.kind) {
    case 'candidate_not_inspected':
    case 'manifest_missing_name':
    case 'manifest_unreadable':
    case 'workspace_dir_unreadable': {
      return diagnostic.path;
    }
    case 'workspace_declaration_unparsed':
    case 'workspace_file_unreadable': {
      return diagnostic.file;
    }
    case 'unsupported_pattern': {
      return diagnostic.pattern;
    }
    // Both, because either alone leaves the reader stuck: the pattern says which declaration was
    // being walked, the path says how far it got.
    case 'scan_budget_exhausted': {
      return `${diagnostic.pattern} at ${diagnostic.path}`;
    }
    case 'no_workspace_declaration': {
      return undefined;
    }
  }
};

/** Why the discovery passes stood down, named so the reader can act on it — `packages/c:
 * manifest_unreadable` tells someone which file to fix, where silence tells them nothing and
 * `ok` actively misleads.
 *
 * Only the kinds that make a scan unreliable appear. `scanIsReliable` is the authority on which
 * those are, so this filters by asking it about each diagnostic alone rather than keeping a second
 * copy of that set to drift. */
const discoveryObstacle = (scan: WorkspaceScan): string =>
  scan.diagnostics
    .filter((diagnostic) => !scanIsReliable({ diagnostics: [diagnostic], packages: [] }))
    .map((diagnostic) => {
      const subject = diagnosticSubject(diagnostic);
      return subject === undefined ? diagnostic.kind : `${subject}: ${diagnostic.kind}`;
    })
    .toSorted()
    .join(OBSTACLE_SEPARATOR);

export { discoveryObstacle };
