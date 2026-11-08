import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { parse } from 'yaml';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

// Runs the `announce` job's Latest decision exactly as release.yml spells it, under bash, with a
// stub `gh` in front of PATH that answers the Latest lookup. The step cannot run end to end without
// a release, and a copy of its script here would pin the copy, not the workflow.

type Step = { id?: string; run?: string };
type Workflow = { jobs: { announce: { steps: Step[] } } };

const WORKFLOW = new URL('../../../.github/workflows/release.yml', import.meta.url);
// eslint-disable-next-line node/no-sync -- read once at collection time
const workflow = parse(readFileSync(WORKFLOW, 'utf8')) as Workflow;
const script = workflow.jobs.announce.steps.find((step) => step.id === 'latest')?.run ?? '';

const EXECUTABLE = 0o755;

type Lookup = { code: number; output: string };
type Decision = { output: string; status: number | null; stderr: string };

const decide = (tag: string, lookup: Lookup): Decision => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  const dir = mkdtempSync(join(tmpdir(), 'refs-latest-'));
  const gh = join(dir, 'gh');
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' "$STUB_OUTPUT"\nexit "$STUB_CODE"\n`);
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  chmodSync(gh, EXECUTABLE);
  const output = join(dir, 'output');
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(output, '');
  const env = { ...process.env, GITHUB_OUTPUT: output, PATH: `${dir}:${process.env['PATH']}` };
  const stub = { STUB_CODE: String(lookup.code), STUB_OUTPUT: lookup.output, TAG: tag };
  // eslint-disable-next-line node/no-sync -- one short child process per case
  const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...env, ...stub } });
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  return { output: readFileSync(output, 'utf8'), status: result.status, stderr: result.stderr };
};

const latest = (tag: string): Lookup => ({ code: 0, output: tag });

describe.skipIf(process.platform === 'win32')('release.yml announce: the Latest decision', () => {
  it('finds the step it tests', () => {
    expect.hasAssertions();
    expect(script).toContain('gh release view');
  });

  it.each([
    ['v0.20.0', 'v0.19.0', 'make_latest=true\n'],
    ['v0.19.1', 'v0.19.0', 'make_latest=true\n'],
    ['v1.0.0', 'v0.19.0', 'make_latest=true\n'],
    ['v0.18.2', 'v0.19.0', 'make_latest=false\n'],
    ['v0.9.0', 'v0.19.0', 'make_latest=false\n'],
    ['v0.19.0', 'v0.19.0', 'make_latest=false\n'],
  ])('%s against Latest %s decides %j', (tag, current, expected) => {
    expect.hasAssertions();
    expect(decide(tag, latest(current))).toMatchObject({ output: expected, status: 0 });
  });

  it('makes the first release Latest when there is none', () => {
    expect.hasAssertions();
    const none = { code: 1, output: 'release not found' };
    expect(decide('v0.1.0', none)).toMatchObject({ output: 'make_latest=true\n', status: 0 });
  });

  it('stops on any other lookup failure instead of defaulting', () => {
    expect.hasAssertions();
    const failure = decide('v0.20.0', { code: 1, output: 'HTTP 502: Bad Gateway' });
    expect(failure).toMatchObject({ output: '', status: 1 });
    expect(failure.stderr).toContain('could not read the current Latest release');
  });

  it.each([
    ['v0.20.0', 'v1.0.0-rc.1'],
    ['v0.20.0', 'nightly'],
    ['v0.20.0-rc.1', 'v0.19.0'],
  ])('refuses to order %s against %s', (tag, current) => {
    expect.hasAssertions();
    const refused = decide(tag, latest(current));
    expect(refused).toMatchObject({ output: '', status: 1 });
    expect(refused.stderr).toContain('is not a plain x.y.z version');
  });
});
