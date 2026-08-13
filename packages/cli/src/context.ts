import type { Fetcher, Runner } from '@kaisers-io/refs-core';
import { SpawnRunner } from '@kaisers-io/refs-core';
import { homedir } from 'node:os';
// eslint-disable-next-line import/no-relative-parent-imports -- package.json lives at the package root, one level above src/
import pkg from '../package.json' with { type: 'json' };

// Every side effect the CLI can perform (reading env, writing stdout/stderr, shelling out,
// fetching over HTTP) is captured here. Production code never touches `process`/stdio/`fetch`
// directly — it takes a `CliContext` and calls through it. `realContext()` below is the ONLY
// place in this package allowed to reach for the real globals; every other module (and every
// test) goes through the injected seam instead.
type CliContext = {
  // This package's own version (`package.json`'s `version` in `realContext()`) — routed through
  // the context like every other real global so `doctor`'s `skill` check can be exercised against
  // an arbitrary version instead of only ever observing the version under test.
  cliVersion: string;
  // The directory the CLI was invoked from (`process.cwd()` in `realContext()`) — routed through
  // the context like every other real global. Added for `doctor`'s `skill` check: `skills add`
  // installs into the CURRENT PROJECT by default (`-g` is opt-in), so `<cwd>/.agents/skills/refs`
  // is a real install location, and it has to be reachable without the check calling
  // `process.cwd()` behind the seam's back.
  cwd: string;
  env: NodeJS.ProcessEnv;
  errLine: (line: string) => void;
  fetcher: Fetcher;
  // The invoking user's home directory (`os.homedir()` in `realContext()`) — routed through the
  // context for the same reason as `cwd`. `doctor`'s `skill` check used to read `$HOME` directly,
  // which agrees with `os.homedir()` on macOS and Linux but not on Windows: there `HOME` is not
  // consulted at all, `os.homedir()` reads `USERPROFILE` and falls back to the profile directory
  // itself, and `HOME` is typically unset. Every global install location silently dropped out and
  // a correctly installed skill reported as missing. The installer resolves `os.homedir()`, so
  // reading the same thing is what keeps the two agreeing.
  //
  // Empty string means "no home", which is also what a homeless environment yields — see
  // `realContext()`.
  homedir: string;
  // The running Node version (`process.version` in `realContext()`) — routed through the context,
  // like every other real global, so `doctor`'s `node` check can be exercised with an arbitrary
  // version string instead of only ever observing whatever interpreter the test happens to run
  // under.
  nodeVersion: string;
  out: (line: string) => void;
  // Reads all of stdin to completion as a utf8 string — the only seam `refs add --proposal -`
  // needs (spec: `--proposal <file|->`, `-` meaning "read the proposal JSON from stdin").
  readStdin: () => Promise<string>;
  runner: Runner;
};

const readRealStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    // `process.stdin`'s async iterator yields `Buffer` in the default (non-object) mode; wrapping
    // in `Buffer.from` keeps this correct even if a future change ever puts stdin into object mode.
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
};

/** `os.homedir()` does not return a fallback when it cannot resolve a home directory — Node wraps
 * the libuv call in `getCheckedFunction` and throws `ERR_SYSTEM_ERROR` instead (`lib/os.js`,
 * verified against v24.12.0). That happens when neither `$HOME` nor `$USERPROFILE` is set and the
 * effective UID has no passwd entry, which is what an arbitrary-UID container looks like.
 *
 * `realContext()` is built before argument parsing, on EVERY command, so letting it escape would
 * take down `refs sync` with `REFS_HOME` pointing somewhere explicit — a run that never needed a
 * home. An empty string is the same "no home" its only reader already handles, and it is also what
 * a set-but-empty `$HOME` yields on POSIX, so the two homeless shapes stay one case. */
const safeHomedir = (): string => {
  try {
    return homedir();
  } catch {
    return '';
  }
};

const realContext = (): CliContext => ({
  cliVersion: pkg.version,
  cwd: process.cwd(),
  env: process.env,
  errLine: (line: string) => {
    process.stderr.write(`${line}\n`);
  },
  fetcher: (url: string, init?: { signal?: AbortSignal }) => fetch(url, init),
  homedir: safeHomedir(),
  nodeVersion: process.version,
  out: (line: string) => {
    process.stdout.write(`${line}\n`);
  },
  readStdin: readRealStdin,
  runner: new SpawnRunner(),
});

export { realContext };
export type { CliContext };
