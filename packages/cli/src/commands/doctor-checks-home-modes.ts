import { DIR_MODE, FILE_MODE } from '@kaisers-io/refs-core';
import type { CheckResult } from './doctor-types.ts';
import type { RefsHome } from '@kaisers-io/refs-core';
import { stat } from 'node:fs/promises';

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

/** The permission bits, or `undefined` for a path that is not there — an absent `state.json` is an
 * ordinary state on a home nothing has been added to, not a finding. */
const permissionsOf = async (path: string): Promise<number | undefined> => {
  try {
    const stats = await stat(path);
    return stats.mode & PERMISSION_BITS;
  } catch {
    return undefined;
  }
};

const tooOpen = async (owned: OwnedPath): Promise<string | undefined> => {
  const mode = await permissionsOf(owned.path);
  if (mode === undefined || (mode & GROUP_AND_OTHER) === 0) {
    return undefined;
  }
  return `${owned.label} is ${asOctal(mode)} (expected ${asOctal(owned.expected)})`;
};

const checkHomeModes = async (home: RefsHome): Promise<CheckResult> => {
  if (process.platform === 'win32') {
    return {
      detail: 'not applicable on this platform — the mode bits do not say who may write',
      name: NAME,
      status: 'ok',
    };
  }
  const found = await Promise.all(ownedPaths(home).map((owned) => tooOpen(owned)));
  const open = found.filter((entry) => entry !== undefined);
  if (open.length === 0) {
    return {
      detail: 'everything refs owns is reachable only by its owner',
      name: NAME,
      status: 'ok',
    };
  }
  return {
    // `refs init` rather than a `chmod` line: it already sets every one of these, it is idempotent,
    // and it needs no path interpolated into a command.
    detail: `${open.join('; ')} — run: refs init`,
    name: NAME,
    status: 'warn',
  };
};

export { checkHomeModes };
