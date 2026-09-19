import { isRegistrablePackageName, zDeclinedPackage, zPackagePath } from '@kaisers-io/refs-core';
import type { StructureIssue } from './drift-report.ts';
import { editCommand } from '../shell-quote.ts';

// The repair commands a finding can offer, as strings — one place, so the human line and the
// `--json` finding cannot differ about what to run.
//
// This exists because of where the two paths diverged. `drift-lines.ts` puts a shell-quoted command
// in the human `detail`, and refuses to print one where the value would not validate. But once a
// directory holds enough unregistered packages, that per-package line is replaced by a single count
// line — so in exactly the large-monorepo case the skill routes an agent to, `detail` carried no
// command at all while `findings` carried the raw `name` and `path`. An agent with a raw value and
// no command has to build one, and the values are not tame: `zPackagePath` admits spaces, `$()`
// and backticks, and a package name comes from a tracked repository's own manifest.
//
// Being verified against the checkout makes a value TRUE, not shell-safe.
//
// A command is ABSENT for two different reasons, and both are honest answers. The configuration
// may be unable to hold the value at all, which makes the command a lie; or the value may be one
// no printed line can carry — `editCommand` answers that one, for every dynamic part at once, so
// neither this module nor a future caller has to remember which values to check.

/** Whether the DECISION can be recorded, which is weaker than whether the package can be
 * registered: `declined_packages` is an array of records, so a name that cannot be a record key is
 * no obstacle there. See the note above `registrable` in `drift-lines.ts`.
 *
 * It asks the STORED SHAPE, `zDeclinedPackage`, rather than the path alone, so that what this
 * offers and what `--decline` accepts cannot drift apart: a name the schema will not store is a
 * command that fails after being pasted. That is strictly weaker than registration — the name is
 * held as a field here, not as a record key, so `constructor` stays declinable. */
const declinable = (issue: StructureIssue): boolean =>
  zDeclinedPackage.safeParse({ name: issue.name, path: issue.path }).success;

type RepairCommands = {
  /** Records "no, and stop asking" — the answer that stops a finding recurring for ever. */
  decline?: string;
  /** Registers the package. Carries a `'<what it is>'` placeholder the caller has to replace with
   * a description written from the package's own source; refs never supplies one. Single-quoted
   * like every other value: in double quotes a `$(…)` the caller substitutes for it would be
   * expanded by their own shell before refs ever saw it. */
  register?: string;
  /** Points a configured entry at where the package moved to. */
  repoint?: string;
  /** Removes a configured entry whose package is gone from the workspaces. */
  unregister?: string;
};

// `path` is passed rather than read off the issue, so these cannot be called without one — the
// caller has already established it. A `?? ''` here would be a fallback no test could reach.
const declineCommand = (issue: StructureIssue, key: string, path: string): string | undefined =>
  editCommand([['--package', issue.name], '--decline', ['--path', path]], [key]);

const registerCommand = (issue: StructureIssue, key: string, path: string): string | undefined =>
  editCommand(
    [['--package', issue.name], '--create', ['--path', path], ['--description', '<what it is>']],
    [key],
  );

/** Both answers, because both are answers. Registering needs a human decision (SKILL.md: never on
 * your own initiative); declining stops the finding returning once that decision was "no".
 *
 * The two carry exactly the same dynamic values, so `decline` being absent settles the printability
 * question for the pair. What `register` alone can be absent for is a name the packages table
 * cannot hold — a member legitimately called `constructor` can be declined but not registered. */
const unregisteredCommands = (issue: StructureIssue, key: string): RepairCommands => {
  const { path } = issue;
  if (path === undefined || !declinable(issue)) {
    return {};
  }
  const decline = declineCommand(issue, key, path);
  const register = isRegistrablePackageName(issue.name)
    ? registerCommand(issue, key, path)
    : undefined;
  if (decline === undefined) {
    return {};
  }
  return register === undefined ? { decline } : { decline, register };
};

const relocatedCommands = (issue: StructureIssue, key: string): RepairCommands => {
  // The PARSED value is used rather than the raw one, so the command is built from exactly what
  // validation accepted and no unreachable fallback is needed to satisfy the type.
  const parsed = zPackagePath.safeParse(issue.path);
  if (!parsed.success) {
    return {};
  }
  const repoint = editCommand([['--package', issue.name]], [key, 'path', parsed.data]);
  return repoint === undefined ? {} : { repoint };
};

const missingCommands = (issue: StructureIssue, key: string): RepairCommands => {
  const unregister = editCommand([['--package', issue.name], '--remove'], [key]);
  return unregister === undefined ? {} : { unregister };
};

/** Every command this finding can offer, quoted for a shell, or an empty object where none can be
 * offered honestly — a path the configuration cannot hold has no command, and neither has a value
 * no printed line can carry. The finding is still true without one. */
const repairCommandsFor = (issue: StructureIssue, key: string): RepairCommands => {
  if (issue.status === 'unregistered') {
    return unregisteredCommands(issue, key);
  }
  if (issue.status === 'relocated') {
    return relocatedCommands(issue, key);
  }
  if (issue.status === 'missing') {
    return missingCommands(issue, key);
  }
  return {};
};

export { declinable, repairCommandsFor, unregisteredCommands };
export type { RepairCommands };
