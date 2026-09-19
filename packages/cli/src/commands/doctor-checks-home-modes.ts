import { DIR_MODE, FILE_MODE } from '@kaisers-io/refs-core';
import { lstat, stat } from 'node:fs/promises';
import type { CheckResult } from './doctor-types.ts';
import type { RefsHome } from '@kaisers-io/refs-core';

// `home-modes` — whether the things refs owns are readable or writable by anyone but their owner.
//
// `refs init` creates and repairs all of them with explicit modes (`0700` directories, `0600`
// files). That repair is the fix; this is what makes it findable. `init` is run once, and a home
// created by an older refs under a permissive umask keeps whatever it got — measured on this host,
// `umask 002` produced `drwxrwxr-x` on the hooks directory and `umask 000` produced `drwxrwxrwx`.
// Somebody who upgrades and only ever runs `sync` is never told, and a fix nobody is told about is
// not one.
//
// `hooks/` is the entry that matters most: it is what every managed checkout's `core.hooksPath`
// points at, and git resolves hook NAMES against it. A second local principal able to write there
// gets code executed as the refs user, with refs' environment, during an ordinary `refs sync`.
//
// Group and other are reported together rather than separately. The distinction is a local policy
// question — a shared group may be deliberate — and refs cannot read that policy, so it names what
// it found and leaves the judgement with the reader. The one thing it does not do is stay quiet.
//
// Windows does not carry POSIX permission bits: `stat` reports a mode there that says nothing about
// who may write, so the check reports that it does not apply rather than inventing a verdict.

const NAME = 'home-modes';

/** Everything `refs init` creates, with the mode it creates it with. */
type OwnedPath = { expected: number; label: string; path: string };

/** The bits that grant anyone other than the owner any access at all. */
const GROUP_AND_OTHER = 0o077;
/** What `stat` reports beyond the file type. */
const PERMISSION_BITS = 0o777;
const OCTAL = 8;
/** `rwx` for owner, group and other. */
const MODE_DIGITS = 3;

const ownedPaths = (home: RefsHome): OwnedPath[] => [
  { expected: DIR_MODE, label: 'the refs home', path: home.root },
  { expected: DIR_MODE, label: 'sources/', path: home.sourcesDir },
  { expected: DIR_MODE, label: 'locks/', path: home.locksDir },
  // Named last of the directories but singled out in the message: this is the one git reads.
  { expected: DIR_MODE, label: 'hooks/', path: home.hooksDir },
  { expected: FILE_MODE, label: 'config.toml', path: home.configPath },
  { expected: FILE_MODE, label: 'state.json', path: home.statePath },
];

const asOctal = (mode: number): string =>
  (mode & PERMISSION_BITS).toString(OCTAL).padStart(MODE_DIGITS, '0');

/** What was found at one path: its mode, that it is not there, or that looking failed.
 *
 * The three are kept apart because collapsing them is how a check starts lying. The first version
 * caught every error and treated it as absence, so an `EACCES`, an `ELOOP` or an `ENOTDIR` produced
 * the same silence as a `state.json` that was simply never written — and the check then reported
 * that nothing was open. A failure to look is never evidence. */
type Observation =
  | { kind: 'absent' }
  | { kind: 'mode'; mode: number; symlink: boolean }
  | { kind: 'unreadable'; reason: string };

/** The only code that means "nothing is there". Everything else is a failure to look. */
const MISSING_CODE = 'ENOENT';

const codeOf = (error: unknown): string =>
  error instanceof Error && 'code' in error ? String(error.code) : 'unknown';

const observe = async (path: string): Promise<Observation> => {
  try {
    // `lstat` as well, because the repair does not treat the two alike: `refs init` deliberately
    // does NOT chmod a symlinked directory — `chmod` follows the link, and the mode of whatever it
    // points at is its own owner's business. Naming `refs init` for a link would advertise a repair
    // that leaves the finding standing.
    const [stats, link] = await Promise.all([stat(path), lstat(path)]);
    return { kind: 'mode', mode: stats.mode & PERMISSION_BITS, symlink: link.isSymbolicLink() };
  } catch (error) {
    const reason = codeOf(error);
    return reason === MISSING_CODE ? { kind: 'absent' } : { kind: 'unreadable', reason };
  }
};

/** What is worth saying about one path, and whether `refs init` is the answer to it. */
type Finding = { repairable: boolean; text: string };

const findingFor = async (owned: OwnedPath): Promise<Finding | undefined> => {
  const seen = await observe(owned.path);
  if (seen.kind === 'absent') {
    // A home nothing has been added to has no `state.json`. That is a state, not a finding.
    return undefined;
  }
  if (seen.kind === 'unreadable') {
    // Not `ok`, and not a mode claim either: nothing was established about this path.
    return { repairable: false, text: `${owned.label} could not be inspected (${seen.reason})` };
  }
  if ((seen.mode & GROUP_AND_OTHER) === 0) {
    return undefined;
  }
  const byHand = seen.symlink ? ' — a symlink; fix it where it points' : '';
  return {
    repairable: !seen.symlink,
    text: `${owned.label} is ${asOctal(seen.mode)} (expected ${asOctal(owned.expected)})${byHand}`,
  };
};

/** The remedy, or none. `refs init` is offered only where it would actually do something: it
 * deliberately does not chmod a symlinked directory, and it cannot act on a path that could not be
 * inspected — printing it there would advertise a repair that leaves the finding standing. */
const remedyFor = (findings: readonly Finding[]): string =>
  findings.some((finding) => finding.repairable) ? ' — run: refs init' : '';

const checkHomeModes = async (home: RefsHome): Promise<CheckResult> => {
  if (process.platform === 'win32') {
    return {
      detail: 'not applicable on this platform — the mode bits do not say who may write',
      name: NAME,
      status: 'ok',
    };
  }
  const found = await Promise.all(ownedPaths(home).map((owned) => findingFor(owned)));
  const open = found.filter((entry) => entry !== undefined);
  if (open.length === 0) {
    return {
      // Narrower than "reachable only by its owner", which mode bits do not establish: an ancestor
      // a second principal can write, an ACL, or a change of owner would each defeat it while every
      // bit here stayed 0.
      detail: 'no group or other permission bits on anything refs owns',
      name: NAME,
      status: 'ok',
    };
  }
  return {
    // `refs init` rather than a `chmod` line: it already sets every one of these, it is idempotent,
    // and it needs no path interpolated into a command.
    detail: `${open.map((finding) => finding.text).join('; ')}${remedyFor(open)}`,
    name: NAME,
    status: 'warn',
  };
};

export { checkHomeModes };
