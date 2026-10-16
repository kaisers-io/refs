import { checkoutRoot, git } from './behavior-files.mjs';
import { join, resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const EXECUTABLE = 0o755;
const exec = promisify(execFile);
const quote = (value) => `'${value.replaceAll("'", String.raw`'\''`)}'`;
const prepareBundle = async () => {
  // Unconditionally rebuild: a reverted implementation must not pass against an old bundle.
  await exec('pnpm', ['--filter', '@kaisers-io/refs', 'build'], { cwd: root });
  const bin = join(root, 'node_modules/.cache/skill-evals/bin');
  await mkdir(bin, { recursive: true });
  await writeFile(
    join(bin, 'refs'),
    `#!/bin/sh\nREFS_ALLOW_FILE_URLS=1 REFS_UPDATE_CHECK=0 exec ${quote(process.execPath)} ${quote(join(root, 'packages/cli/bin/refs.mjs'))} "$@"\n`,
    { mode: EXECUTABLE },
  );
  return bin;
};
const answerFor = async (spec, cwd) => {
  const citations = await Promise.all(
    spec.citations.map(async (entry) => {
      const source = await git(await checkoutRoot(cwd, entry.repo), [
        'show',
        `${entry.revision}:${entry.path}`,
      ]);
      const index = source.split('\n').findIndex((line) => line.includes(entry.needle));
      return {
        end_line: index + 1,
        id: entry.id,
        path: entry.path,
        quote: source.split('\n')[index],
        revision: entry.revision,
        root: await checkoutRoot(cwd, entry.repo),
        start_line: index + 1,
      };
    }),
  );
  const answer = { citations, facts: spec.facts };
  if (spec.history) {
    const { repo: _repo, before_revision: _beforeRevision, ...history } = spec.history;
    answer.history = history;
  }
  return answer;
};
const fixture = async (name, bin) => {
  const home = await mkdtemp(join(tmpdir(), 'refs-behavior-test-'));
  const cwd = join(home, 'cwd');
  await mkdir(cwd);
  await exec(join(root, 'evals', name, 'scaffold.sh'), [], {
    cwd,
    env: { HOME: home, LANG: 'C.UTF-8', PATH: `${bin}:${process.env.PATH}` },
  });
  const spec = JSON.parse(await readFile(join(root, 'evals', name, 'behavior.json'), 'utf8'));
  const answer = await answerFor(spec, cwd);
  await writeFile(join(cwd, 'answer.json'), JSON.stringify(answer));
  return { answer, cwd, home, name, spec };
};

export { fixture, prepareBundle };

export { wrapperReport } from './claude-test-host.mjs';
