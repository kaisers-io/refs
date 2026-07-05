import type { Fetcher, Runner } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { SpawnRunner } from '@kaisers-io/refs-core';

// Every side effect the CLI can perform (reading env, writing stdout/stderr, shelling out,
// Fetching over HTTP) is captured here. Production code never touches `process`/stdio/`fetch`
// Directly — it takes a `CliContext` and calls through it. `realContext()` below is the ONLY
// Place in this package allowed to reach for the real globals; every other module (and every
// Test) goes through the injected seam instead.
interface CliContext {
  env: NodeJS.ProcessEnv;
  errLine: (line: string) => void;
  fetcher: Fetcher;
  // The running Node version (`process.version` in `realContext()`) — routed through the context,
  // like every other real global, so `doctor`'s `node` check can be exercised with an arbitrary
  // version string instead of only ever observing whatever interpreter the test happens to run
  // under.
  nodeVersion: string;
  out: (line: string) => void;
  // Reads all of stdin to completion as a utf8 string — the only seam `refs add --proposal -`
  // Needs (spec: `--proposal <file|->`, `-` meaning "read the proposal JSON from stdin").
  readStdin: () => Promise<string>;
  runner: Runner;
}

const readRealStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    // `process.stdin`'s async iterator yields `Buffer` in the default (non-object) mode; wrapping
    // In `Buffer.from` keeps this correct even if a future change ever puts stdin into object mode.
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
};

const realContext = (): CliContext => ({
  env: process.env,
  errLine: (line: string) => {
    process.stderr.write(`${line}\n`);
  },
  fetcher: (url: string) => fetch(url),
  nodeVersion: process.version,
  out: (line: string) => {
    process.stdout.write(`${line}\n`);
  },
  readStdin: readRealStdin,
  runner: new SpawnRunner(),
});

export { realContext };
export type { CliContext };
