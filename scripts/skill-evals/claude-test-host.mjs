import { join, resolve } from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { absent } from './behavior-files.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const EXECUTABLE = 0o755;
const root = resolve(import.meta.dirname, '../..');
const optionalReport = async (path) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
};
const hostSource = (report, mode, marker) => {
  const write = mode.includes('no-report')
    ? ''
    : `fs.writeFileSync(path, ${JSON.stringify(JSON.stringify(report))});`;
  const stop = mode.includes('signal') ? "process.kill(process.pid, 'SIGTERM');" : '';
  const fail = mode === 'failure' ? 'process.exitCode = 1;' : '';
  return `#!${process.execPath}\nconst fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(marker)}, 'started');\nconst path = process.argv[process.argv.indexOf('--json') + 1];\n${write}\n${stop}\n${fail}\n`;
};
const wrapperReport = async (entry, report, control = {}) => {
  const bin = await mkdtemp(join(entry.home, 'fake-host-'));
  const output = join(bin, 'native.json');
  if (control.stale) {
    await writeFile(
      control.stale === 'verified' ? output.replace('.json', '.verified.json') : output,
      JSON.stringify(report),
    );
  }
  await writeFile(
    join(bin, 'claude'),
    hostSource(report, control.mode ?? 'normal', join(bin, 'called')),
    { mode: EXECUTABLE },
  );
  const options = { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
  const outcome = await promisify(execFile)(
    process.execPath,
    [join(root, 'scripts/skill-evals/claude-run.mjs'), '--case', entry.name, '--json', output],
    options,
  ).catch((error) => error);
  return {
    called: !(await absent(join(bin, 'called'))),
    code: outcome instanceof Error ? (outcome.code ?? 1) : 0,
    native: await optionalReport(output),
    stderr: outcome.stderr,
    verified: await optionalReport(output.replace('.json', '.verified.json')),
  };
};

export { wrapperReport };
