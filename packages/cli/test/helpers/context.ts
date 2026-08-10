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

/** Default `ctx.cwd`: an absolute path that does not exist, never the real `process.cwd()`.
 * `doctor`'s `skill` check looks for a project-scoped install under `<cwd>/.agents/skills/refs`,
 * and THIS repository's own checkout has exactly that (`.agents/skills/refs` -> `skills/refs`), so
 * a real cwd would make the suite read the developer's working tree and quietly invert the "nothing
 * installed" cases. Tests that exercise project scope assign `ctx.cwd` directly, mirroring how
 * `ctx.env['HOME']` is pointed at a temp directory. */
const ABSENT_CWD = '/refs-test-cwd-that-does-not-exist';

/** Default `ctx.homedir`: an absolute path that does not exist, never the real `os.homedir()`, for
 * the same reason as `ABSENT_CWD` — the developer running the suite has a real `~/.claude` or
 * `~/.agents`, and reading it would invert every "nothing installed" case. Tests that exercise a
 * global install assign `ctx.homedir` a temp directory. */
const ABSENT_HOME = '/refs-test-home-that-does-not-exist';

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
    cwd: ABSENT_CWD,
    env: {},
    errLine: (line: string) => {
      stderr.push(line);
    },
    fetcher: unstubbedFetcher,
    homedir: ABSENT_HOME,
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
