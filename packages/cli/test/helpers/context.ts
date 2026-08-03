import type { CliContext } from '../../src/context.ts';
import { FakeRunner } from '@kaisers-io/refs-core';

// In-memory `CliContext` for tests: `env` starts empty, `runner` is a scripted `FakeRunner`
// (queue responses via `runner.expect(...)` before exercising code that shells out), and
// `fetcher` rejects unless a test overrides `ctx.fetcher` directly — nothing here ever touches
// The real process, filesystem, or network.
const unstubbedFetcher = (): Promise<{ json: () => Promise<unknown>; status: number }> =>
  Promise.reject(new Error('testContext: fetcher was not stubbed for this test'));

// Default `ctx.readStdin`: an empty string, never the real process's stdin — tests that need
// Specific stdin content (e.g. `refs add --proposal -`) assign `ctx.readStdin` directly, mirroring
// How `ctx.fetcher` is overridden per-test.
const stubbedReadStdin = (): Promise<string> => Promise.resolve('');

const testContext = (): {
  ctx: CliContext;
  runner: FakeRunner;
  stderr: string[];
  stdout: string[];
} => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const runner = new FakeRunner();
  const ctx: CliContext = {
    // Defaults to a fixed version so every non-`skill`-check test keeps working unmodified;
    // `doctor` tests that need a specific version override `ctx.cliVersion` directly, mirroring
    // how `ctx.nodeVersion`/`ctx.fetcher` are overridden per-test.
    cliVersion: '0.0.0-test',
    env: {},
    errLine: (line: string) => {
      stderr.push(line);
    },
    fetcher: unstubbedFetcher,
    // Defaults to the real interpreter's version so every non-`node`-check test keeps working
    // unmodified; `doctor` tests that need a specific version override `ctx.nodeVersion` directly,
    // mirroring how `ctx.fetcher`/`ctx.readStdin` are overridden per-test above.
    nodeVersion: process.version,
    out: (line: string) => {
      stdout.push(line);
    },
    readStdin: stubbedReadStdin,
    runner,
  };
  return { ctx, runner, stderr, stdout };
};

export { testContext };
