#!/usr/bin/env node
// Preserve Claude's native report unchanged, then require the same evidence checks as Codex.
import { readNative, reportPaths } from './claude-reports.mjs';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { verifyClaudeReport } from './claude-postflight.mjs';
import { writeFile } from 'node:fs/promises';

const JSON_INDENT = 2;
const EXEC_ARGUMENTS = 2;
const OPTION_AND_VALUE = 2;
const ABSENT = -1;
const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(EXEC_ARGUMENTS);
const jsonIndex = args.indexOf('--json');
const supplied =
  jsonIndex !== ABSENT && args[jsonIndex + 1]?.endsWith('.json') ? args[jsonIndex + 1] : undefined;
const paths = await reportPaths(root, supplied);
if (jsonIndex !== ABSENT) {
  args.splice(jsonIndex, supplied ? OPTION_AND_VALUE : 1);
}
const child = spawn(
  'claude',
  [
    'plugin',
    'eval',
    root,
    ...args,
    '--scaffold',
    '--allow-tools',
    'Bash',
    'Write',
    'Edit',
    '--ablation',
    'none',
    '--no-publish',
    '--keep-temp',
    '--json',
    paths.staged,
  ],
  { stdio: 'inherit' },
);
const [code, signal] = await once(child, 'exit');
if (code !== 0 || signal !== null) {
  throw new Error(
    `Claude host did not exit successfully (code=${code}, signal=${signal}); evidence unverified; retained report: ${paths.staged}`,
  );
}
const raw = await readNative(paths);
const verified = await verifyClaudeReport(raw);
await writeFile(paths.verified, `${JSON.stringify(verified, undefined, JSON_INDENT)}\n`, {
  flag: 'wx',
});
console.log(
  `Evidence postflight: ${verified.evidenceVerified ? 'passed' : 'FAILED / unverified'} (${paths.verified})`,
);
process.exitCode = verified.evidenceVerified ? 0 : 1;
