// Package identity: a configured `path` is only a LOCATOR — the package NAME is the identity.
// Every question here is asked by name, never by path, which is what makes an upstream move a
// FACT (the manifest still declares the same name) rather than a guess.
import { isAbsolute, join } from 'node:path';
import type { ContainmentResult } from './fs-containment.ts';
import type { WorkspacePackage } from './workspaces-patterns.ts';
import { compareCodepoint } from './workspaces-patterns.ts';
import { extractPackageName } from './workspaces-parse.ts';
import { readFile } from 'node:fs/promises';
import { resolveInside } from './fs-containment.ts';

const PARENT_DIR_SEGMENT = '..';
const MANIFEST_FILE = 'package.json';

type ManifestProbe =
  | { found: string | undefined; kind: 'mismatch' }
  | { kind: 'absent' }
  | { kind: 'match' }
  | { kind: 'unreadable'; reason: string };

/** Pure, no-IO rejection of a stored path that could never be inside the checkout: absolute, or
 * containing a `..` segment. Runs BEFORE any filesystem call, mirroring `isSafeWorkspacePattern`'s
 * role in `workspaces-patterns.ts`. */
const isLexicallySafe = (relPath: string): boolean => {
  if (isAbsolute(relPath)) {
    return false;
  }
  return !relPath.split(/[/\\]/u).includes(PARENT_DIR_SEGMENT);
};

// Maps a non-`inside` containment result onto a probe outcome. `missing` is the only one that
// becomes `absent`; `outside` and `unreadable` are both failures to CHECK, never evidence that a
// package is gone.
const probeFromContainment = (
  result: Exclude<ContainmentResult, { kind: 'inside' }>,
  what: string,
): ManifestProbe => {
  if (result.kind === 'missing') {
    return { kind: 'absent' };
  }
  return result.kind === 'outside'
    ? { kind: 'unreadable', reason: `${what} escapes the checkout` }
    : { kind: 'unreadable', reason: result.code };
};

/** Does the manifest at `relPath` inside `checkoutDir` declare `expectedName`?
 *
 * Two things here are load-bearing and easy to get subtly wrong:
 *
 * 1. **`absent` vs `unreadable`.** A read that FAILS is not a package that is GONE. Malformed
 *    JSON, EACCES, a symlink resolving outside the checkout — none of them is evidence of
 *    removal, and reporting them as such would let a drift detector delete real config entries.
 *    Only a path that is genuinely not there is `absent`.
 *
 *    (This is NOT about blobless clones. `--filter=blob:none` without `--no-checkout` checks out
 *    a complete working tree — verified empirically: with the promisor remote deleted outright, a
 *    working-tree read still succeeds while `git show HEAD~1:<file>` fails on the one missing
 *    historical blob. Working-tree reads never touch the network.)
 *
 * 2. **Containment is established BEFORE reading, never after.** A symlinked `package.json`
 *    pointing outside the checkout must be rejected without its contents ever being read.
 *    Resolving first also means a genuinely missing directory reports `absent` rather than being
 *    swallowed by a failed containment check — `realpath` THROWS on a nonexistent path, so
 *    checking containment first and asking questions later would make `absent` unreachable for
 *    the single most common case: a package that moved. */
const probePackageIdentity = async (
  checkoutDir: string,
  relPath: string,
  expectedName: string,
): Promise<ManifestProbe> => {
  if (!isLexicallySafe(relPath)) {
    return { kind: 'unreadable', reason: 'path escapes the checkout' };
  }

  const manifest = await locateManifest(checkoutDir, relPath);
  if ('probe' in manifest) {
    return manifest.probe;
  }

  const read = await readManifestName(manifest.real);
  if ('reason' in read) {
    return { kind: 'unreadable', reason: read.reason };
  }

  return read.found === expectedName ? { kind: 'match' } : { found: read.found, kind: 'mismatch' };
};

// Resolves the package directory, then the manifest inside it — in that order, so each step's
// failure is attributed to the right thing ("path escapes" vs "manifest escapes"). Returns
// either the resolved manifest path or the probe outcome that ends the check.
const locateManifest = async (
  checkoutDir: string,
  relPath: string,
): Promise<{ probe: ManifestProbe } | { real: string }> => {
  const dir = await resolveInside(checkoutDir, join(checkoutDir, relPath));
  if (dir.kind !== 'inside') {
    return { probe: probeFromContainment(dir, 'path') };
  }

  const manifest = await resolveInside(checkoutDir, join(dir.real, MANIFEST_FILE));
  if (manifest.kind !== 'inside') {
    return { probe: probeFromContainment(manifest, 'manifest') };
  }
  return { real: manifest.real };
};

// Reads and parses one manifest, reporting failure as a value. A manifest that parses but
// declares no `name` is NOT a failure — it is a successful read of something that is not the
// package we were looking for, which the caller reports as a mismatch.
const readManifestName = async (
  manifestPath: string,
): Promise<{ found: string | undefined } | { reason: string }> => {
  try {
    const data = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    return { found: extractPackageName(data) };
  } catch (error) {
    return { reason: (error as NodeJS.ErrnoException).code ?? String(error) };
  }
};

type IdentityLookup =
  | { kind: 'absent' }
  | { kind: 'ambiguous'; paths: string[] }
  | { kind: 'found'; path: string };

const SINGLE_MATCH = 1;
const NO_MATCHES = 0;

/** Where does the package named `name` live, according to this scan?
 *
 * Returns `ambiguous` — never a pick — when the name occurs more than once. Detection
 * deduplicates by path, so duplicate names legitimately survive: an upstream migration with the
 * old and new location both present is the ordinary case. Choosing between them is a judgement
 * no deterministic rule can make correctly, and a wrong pick would silently route an agent to
 * the wrong source. */
const lookupPackagePath = (packages: readonly WorkspacePackage[], name: string): IdentityLookup => {
  const paths = packages.filter((pkg) => pkg.name === name).map((pkg) => pkg.path);
  if (paths.length === NO_MATCHES) {
    return { kind: 'absent' };
  }
  if (paths.length === SINGLE_MATCH) {
    return { kind: 'found', path: paths[0] as string };
  }
  // Codepoint order, not `localeCompare` — the candidate list is asserted exactly in tests that
  // run on macOS, Linux and Windows. See `compareCodepoint` in `workspaces-patterns.ts`.
  return { kind: 'ambiguous', paths: paths.toSorted(compareCodepoint) };
};

export { lookupPackagePath, probePackageIdentity };
export type { IdentityLookup, ManifestProbe };
