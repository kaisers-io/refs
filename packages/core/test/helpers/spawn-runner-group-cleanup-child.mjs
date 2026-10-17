// Fixture process for `test/proc/runner-timeout-tree.test.ts`, run as `node <this file> <pidFile>`:
// a stand-in for a refs CLI that is mid-`run()` on a git command WITH a deadline when it is
// signalled. Its child starts a helper on the same pipes (as git starts `git-remote-http`), writes
// the helper's pid to `pidFile`, and both wait. Imports `SpawnRunner` from source, as
// spawn-runner-cleanup-child.mjs does.

import { SpawnRunner } from '../../src/proc/runner.ts';

const CLI_ARGS_OFFSET = 2;
const DEADLINE_MS = 60_000;
const [pidFile] = process.argv.slice(CLI_ARGS_OFFSET);

const CHILD_SCRIPT = [
  "const { spawn } = require('node:child_process');",
  "const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });",
  "require('node:fs').writeFileSync(process.argv[1], String(helper.pid));",
  'setInterval(() => {}, 1000);',
].join('\n');

const result = await new SpawnRunner().run(process.execPath, ['-e', CHILD_SCRIPT, pidFile], {
  timeoutMs: DEADLINE_MS,
});
process.stdout.write(`resolved:${JSON.stringify(result)}\n`);
