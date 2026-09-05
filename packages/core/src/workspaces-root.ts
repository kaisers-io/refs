import { CURRENT_DIR_SEGMENT } from './workspaces-patterns.ts';
import type { ProbedDir } from './workspaces-probe.ts';
import type { WorkspacePackage } from './workspaces-patterns.ts';
import { probePackageDir } from './workspaces-probe.ts';

// The repository root as a package in its own right. Split from `workspaces.ts` — which owns
// declaration reading and glob expansion — because the root is reached by neither: it is found by
// looking, on this module's own initiative, and every rule about what that means lives here.

/** The repository's own root manifest, when it declares a name.
 *
 * A workspace root is not one of its own glob targets, so expansion never reaches it — and a root
 * that names itself is then registered nowhere, which is why resolving a monorepo by the name in
 * its own `package.json` used to come back empty (#88). Both pnpm and Yarn address the root by
 * that name (`pnpm --filter <root-name>`, `yarn workspace <root-name>`); npm and Turborepo use a
 * positional handle instead. Registering it costs nothing where the name is a throwaway — nobody
 * resolves `"root"` or `"monorepo-root"` — and answers the question where it is not.
 *
 * Deliberately its own probe rather than a `.` pattern smuggled into the expansion: no declaration
 * selected the root, and pretending one did would misreport what the repo actually declares.
 *
 * Contributes a package or nothing — never a diagnostic. A diagnostic here would say "a candidate
 * could not be inspected", and there is no candidate: nothing declared the root, this probe went
 * looking on its own. A root that names nothing is the ordinary case (most workspace roots are
 * private and carry `root` or no name at all), and reporting it on every scan of every repository
 * would bury the diagnostics that do mean something. */
const probeRootPackage = async (repoDir: string): Promise<ProbedDir[]> => {
  const probed = await probePackageDir(repoDir, CURRENT_DIR_SEGMENT);
  return 'pkg' in probed ? [probed] : [];
};

/** The root, dropped when a workspace member already claims its name — the member wins.
 *
 * Applied here rather than at any one consumer, because every consumer has to agree: `refs add`
 * must not silently keep whichever entry came last, and relocation must still find a member that
 * MOVED — against a scan holding both, that lookup returns `ambiguous` and leaves `resolve` with
 * no path for a package that is plainly there. The member wins because it is the more specific
 * thing, and because it is what was registered before roots were looked at at all. */
const withoutClaimedRoot = (packages: readonly WorkspacePackage[]): WorkspacePackage[] => {
  const root = packages.find((pkg) => pkg.path === CURRENT_DIR_SEGMENT);
  if (root === undefined) {
    return [...packages];
  }
  const claimed = packages.some(
    (pkg) => pkg.path !== CURRENT_DIR_SEGMENT && pkg.name === root.name,
  );
  return claimed ? packages.filter((pkg) => pkg !== root) : [...packages];
};

/** The repository's own root package, if its root manifest declares a name — one manifest read,
 * no glob expansion.
 *
 * Separate from a full scan on purpose: the drift probe asks this on every sync, of every ref, to
 * notice a root that was never registered, and making that question cost a whole workspace walk
 * would be a real tax on the common path where nothing is wrong. */
const readRootPackage = async (repoDir: string): Promise<WorkspacePackage | undefined> => {
  const [probed] = await probeRootPackage(repoDir);
  return probed !== undefined && 'pkg' in probed ? probed.pkg : undefined;
};

export { probeRootPackage, readRootPackage, withoutClaimedRoot };
