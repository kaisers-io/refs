import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { parse } from 'yaml';

type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
type Job = { 'timeout-minutes'?: number; steps?: Step[] };
type Workflow = {
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  jobs: Record<string, Job>;
};

const directory = new URL('../../../.github/workflows/', import.meta.url);
const load = async (name: string): Promise<Workflow> =>
  parse(await readFile(new URL(name, directory), 'utf8')) as Workflow;
const names = await readdir(directory);
const workflows = await Promise.all(
  names
    .filter((name) => /\.ya?ml$/u.test(name))
    .map(async (name) => ({ name, workflow: await load(name) })),
);
const jobs = workflows.flatMap(({ name, workflow }) =>
  Object.entries(workflow.jobs).map(([jobName, job]) => ({ job, name: `${name}/${jobName}` })),
);
const steps = jobs.flatMap(({ name, job }) => (job.steps ?? []).map((step) => ({ name, step })));
const checkouts = steps.filter(({ step }) => step.uses?.startsWith('actions/checkout@'));
const ci = await load('ci.yml');
const release = await load('release.yml');
const releaseSetup = Object.values(release.jobs)
  .flatMap((job) => job.steps ?? [])
  .filter((step) => step.uses?.startsWith('actions/setup-node@'));

describe('workflow hardening', () => {
  it.each(jobs)('$name bounds execution', ({ job }) => {
    expect.hasAssertions();
    expect(job['timeout-minutes']).toBeGreaterThan(0);
  });

  it.each(checkouts)('$name leaves no checkout credential', ({ step }) => {
    expect.hasAssertions();
    expect(step.with?.['persist-credentials']).toBe(false);
  });

  it('cancels superseded CI only within the same workflow and ref', () => {
    expect.hasAssertions();
    expect(ci.concurrency).toStrictEqual({
      'cancel-in-progress': true,
      // GitHub expressions, intentionally literal rather than JavaScript interpolation.
      // eslint-disable-next-line no-template-curly-in-string
      group: '${{ github.workflow }}-${{ github.ref }}',
    });
  });

  it('does not cancel release runs', () => {
    expect.hasAssertions();
    expect(release.concurrency).toBeUndefined();
  });

  it.each(releaseSetup)('explicitly disables release package caches', (step) => {
    expect.hasAssertions();
    expect(step.with?.['package-manager-cache']).toBe(false);
    expect(step.with?.['cache']).toBeUndefined();
  });

  it('audits all workflows with a pinned scanner and fails on parsing errors', () => {
    expect.hasAssertions();
    const audit = ci.jobs['workflows']?.steps?.find((step) => step.run?.includes('zizmor'));
    expect(audit?.run).toMatch(/pipx run --spec zizmor==\d+\.\d+\.\d+ zizmor/u);
    expect(audit?.run).toContain('--strict-collection --format=github .github/workflows');
  });
});
