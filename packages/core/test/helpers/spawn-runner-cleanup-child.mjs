// Fixture process for `test/proc/spawn-runner-cleanup.test.ts` — deliberately plain JS (not a
// `.test.ts` file vitest would ever collect) invoked directly via `node <this file> <markerPath>`
// as its own real OS process, standing in for a `refs` CLI invocation that is mid-`run()` when its
// parent is killed. Imports `SpawnRunner` straight from source (`.ts`, relying on Node 24's native
// type-stripping — the same runtime this repo requires) rather than a build step, kicks off a
// long-running `sleep` through it (no `timeoutMs`), and touches `markerPath` once that child has
// actually started — the test polls for that file before sending this process a signal, so it
// never races the child not existing yet.

import { SpawnRunner } from '../../src/proc/runner.ts';

const CLI_ARGS_OFFSET = 2;
const [markerPath] = process.argv.slice(CLI_ARGS_OFFSET);
const runner = new SpawnRunner();

// Never expected to resolve in the test's happy path (this process is killed by SIGTERM first,
// which `SpawnRunner`'s own installed handler re-raises after cleanup — see `spawn-cleanup.ts`);
// written defensively so a bug that leaves this process alive is still observable instead of
// hanging silently.
try {
  const result = await runner.run('sh', ['-c', `touch ${markerPath} && sleep 30`]);
  process.stdout.write(`resolved:${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`rejected:${String(error)}\n`);
}
