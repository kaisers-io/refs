// Reading the two workspace declarations — `package.json`'s `workspaces` field and
// `pnpm-workspace.yaml`'s `packages:` list — and reporting when one of them exists but cannot be
// used. The distinction this module exists for: an ABSENT declaration is the normal state for
// most repos and must never be reported as a failure, while a declaration that is present and
// unreadable means the resulting scan may be missing packages.
import { collectPnpmPatterns, parseNpmWorkspaces } from './workspaces-parse.ts';
import type { WorkspaceDiagnostic } from './workspaces-patterns.ts';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { resolveInside } from './fs-containment.ts';

// A pattern collector's outcome: the patterns it found, plus whether the declaration was usable.
type CheckedPatterns = {
  ok: boolean;
  patterns: Set<string>;
  // The declaration named workspaces in a shape this reader cannot parse. Distinct from `!ok`
  // (could not read it at all) and from an absent declaration (normal).
  unparsed?: boolean;
};

// Shared read path for both workspace declarations. Returns `ok: false` only when the file
// EXISTS and could not be used — unreadable, or resolving outside the repo. An absent
// declaration is `ok: true` with no content: most repos have no workspaces at all, and calling
// that a failure would mark every ordinary scan unreliable.
const readDeclarationFile = async (
  repoDir: string,
  filePath: string,
): Promise<{ content?: string; ok: boolean }> => {
  const located = await resolveInside(repoDir, filePath);
  if (located.kind === 'missing') {
    return { ok: true };
  }
  if (located.kind !== 'inside') {
    return { ok: false };
  }
  try {
    return { content: await readFile(located.real, 'utf8'), ok: true };
  } catch {
    return { ok: false };
  }
};

// Collect npm workspace patterns from the root package.json.
const collectNpmPatternsChecked = async (
  repoDir: string,
  packageJsonPath: string,
): Promise<CheckedPatterns> => {
  const read = await readDeclarationFile(repoDir, packageJsonPath);
  if (!read.ok) {
    return { ok: false, patterns: new Set<string>() };
  }
  if (read.content === undefined) {
    return { ok: true, patterns: new Set<string>() };
  }
  return parseNpmDeclaration(read.content);
};

// Parse the `workspaces` field out of an already-read root manifest. Malformed JSON is a
// failure, not an absence: the declaration is there, we just cannot use it.
const parseNpmDeclaration = (content: string): CheckedPatterns => {
  const patterns = new Set<string>();
  try {
    const npmData = JSON.parse(content) as Record<string, unknown>;
    parseNpmWorkspaces(npmData['workspaces']).forEach((pattern) => patterns.add(pattern));
  } catch {
    return { ok: false, patterns };
  }
  return { ok: true, patterns };
};

// Collect pnpm workspace patterns.
//
// Scope limit worth knowing: `collectPnpmPatterns` is a line parser, not a YAML parser, so
// `ok: false` here means the file could not be READ, never "the YAML is invalid" — plenty of
// malformed YAML parses as empty or partial with nothing to report. Diagnosing that would mean
// adding a real YAML parser.
// A `packages` key at column 0, whatever follows it. `collectPnpmPatterns` only recognises the
// block form (`packages:` alone on its line, then `- item` lines), so this is how we notice that
// a file DOES declare workspaces in a form we cannot read — most commonly YAML flow style,
// `packages: ["a/*"]`, which is perfectly valid.
const PNPM_PACKAGES_KEY = /^packages:/mu;

const collectPnpmPatternsChecked = async (
  repoDir: string,
  pnpmWorkspacePath: string,
): Promise<CheckedPatterns> => {
  const patterns = new Set<string>();
  const read = await readDeclarationFile(repoDir, pnpmWorkspacePath);
  if (!read.ok) {
    return { ok: false, patterns };
  }
  if (read.content === undefined) {
    return { ok: true, patterns };
  }

  collectPnpmPatterns(read.content.split('\n')).forEach((pattern) => patterns.add(pattern));
  // Keyed on the KEY, not the file: a pnpm 9 catalog-only `pnpm-workspace.yaml` legitimately
  // declares no `packages` at all, and must not be reported as unparsed.
  return {
    ok: true,
    patterns,
    unparsed: patterns.size === 0 && PNPM_PACKAGES_KEY.test(read.content),
  };
};

// Both workspace declarations, merged. Each contributes a diagnostic only when it EXISTS and is
// unusable — an absent declaration is the normal state for most repos.
const readDeclarations = async (
  repoDir: string,
): Promise<{ diagnostics: WorkspaceDiagnostic[]; patterns: Set<string> }> => {
  const [npmRead, pnpmRead] = await Promise.all([
    collectNpmPatternsChecked(repoDir, join(repoDir, 'package.json')),
    collectPnpmPatternsChecked(repoDir, join(repoDir, 'pnpm-workspace.yaml')),
  ]);
  const diagnostics: WorkspaceDiagnostic[] = [];
  if (!npmRead.ok) {
    diagnostics.push({ file: 'package.json', kind: 'workspace_file_unreadable' });
  }
  if (!pnpmRead.ok) {
    diagnostics.push({ file: 'pnpm-workspace.yaml', kind: 'workspace_file_unreadable' });
  }
  if (pnpmRead.unparsed === true) {
    diagnostics.push({ file: 'pnpm-workspace.yaml', kind: 'workspace_declaration_unparsed' });
  }
  return { diagnostics, patterns: new Set<string>([...npmRead.patterns, ...pnpmRead.patterns]) };
};

export { readDeclarations };
export type { CheckedPatterns };
