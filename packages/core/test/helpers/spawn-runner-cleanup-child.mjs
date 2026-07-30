// Fixture process for `test/proc/spawn-runner-cleanup.test.ts` — deliberately plain JS (not a
// `.test.ts` file vitest would ever collect) invoked directly via `node <this file> <markerPath>`
// as its own real OS process, standing in for a `refs` CLI invocation that is mid-`run()` when its
// parent is killed. Imports `SpawnRunner` straight from source (`.ts`, relying on Node 24's native
// type-stripping — the same runtime this repo requires) rather than a build step, kicks off a
// long-hanging `node -e` child through it (no `timeoutMs`; `node`, not `sh`/`sleep`, so the chain
// is identical on Windows), which writes `markerPath` once it has actually started — the test
// polls for that file before sending this process a signal, so it never races the child not
// existing yet.

import { SpawnRunner } from '../../src/proc/runner.ts';

const CLI_ARGS_OFFSET = 2;
const [markerPath] = process.argv.slice(CLI_ARGS_OFFSET);
const runner = new SpawnRunner();

const MARKER_THEN_HANG_SCRIPT =
  "require('node:fs').writeFileSync(process.argv[1], ''); setTimeout(() => {}, 30000);";

// Never expected to resolve in the test's happy path (this process is killed by a catchable
// signal first, which `SpawnRunner`'s own installed handler re-raises after cleanup — see
// `spawn-cleanup.ts`); written defensively so a bug that leaves this process alive is still
// observable instead of hanging silently.
try {
  const result = await runner.run(process.execPath, ['-e', MARKER_THEN_HANG_SCRIPT, markerPath]);
  process.stdout.write(`resolved:${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`rejected:${String(error)}\n`);
}
