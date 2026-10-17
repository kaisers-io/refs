import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { parse } from 'yaml';

// What the zizmor job in ci.yml cannot hold. It flags a checkout that persists its token, but no
// zizmor audit at any persona notices a job without `timeout-minutes`, and its pedantic
// `concurrency-limits` pushes release.yml toward the cancellation group it must not have. These
// are this repository's rules for its own workflows (#215), checked on every test run.

type Job = { 'timeout-minutes'?: unknown };
type Workflow = { concurrency?: unknown; jobs: Record<string, Job> };

const DIRECTORY = new URL('../../../.github/workflows/', import.meta.url);
// Several times the slowest job's observed duration, far under GitHub's 360-minute default.
const MAX_TIMEOUT_MINUTES = 60;
const entries = await readdir(DIRECTORY);
const names = entries.filter((name) => /\.ya?ml$/u.test(name)).toSorted();
const workflows = new Map<string, Workflow>(
  await Promise.all(
    names.map(
      async (name) =>
        [name, parse(await readFile(new URL(name, DIRECTORY), 'utf8')) as Workflow] as const,
    ),
  ),
);
const jobs = [...workflows].flatMap(([name, workflow]) =>
  Object.entries(workflow.jobs).map(([id, job]) => ({ id: `${name} ${id}`, job })),
);

// A pull request run shares its group with the next push to that pull request and is cancelled by
// it; a push to main gets a group of its own, because a shared group keeps only one run pending
// and cancels the one it displaces, which would leave that main commit without a result.
const GROUP =
  // eslint-disable-next-line no-template-curly-in-string -- GitHub expressions, not JS templates
  "${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}";

describe('workflow hardening', () => {
  it('finds the workflows it guards', () => {
    expect.hasAssertions();
    expect(names).toStrictEqual(expect.arrayContaining(['ci.yml', 'release.yml']));
  });

  it.each(jobs)('$id stops a hung run long before the 360-minute default', ({ job }) => {
    expect.hasAssertions();
    expect(job['timeout-minutes']).toBeGreaterThan(0);
    expect(job['timeout-minutes']).toBeLessThanOrEqual(MAX_TIMEOUT_MINUTES);
  });

  it.each(['ci.yml', 'skill-audit.yml'])('%s cancels only superseded pull request runs', (name) => {
    expect.hasAssertions();
    expect(workflows.get(name)?.concurrency).toStrictEqual({
      'cancel-in-progress': true,
      group: GROUP,
    });
  });

  it('never cancels or replaces a release run', () => {
    expect.hasAssertions();
    expect(workflows.get('release.yml')).toBeDefined();
    expect(workflows.get('release.yml')?.concurrency).toBeUndefined();
  });
});
