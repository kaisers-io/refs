import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { parse } from 'yaml';

// The hardening the workflows carry, pinned so a new job or step cannot quietly drop it. zizmor
// (workflow-audit.yml) runs only when `.github/**` changes and judges by its own rules; these are
// this repository's rules, and they run with every test run.

type Step = { name?: string; run?: string; uses?: string; with?: Record<string, unknown> };
type Job = { steps?: Step[]; 'timeout-minutes'?: number };
type Workflow = {
  concurrency?: { 'cancel-in-progress'?: unknown; group?: string };
  jobs: Record<string, Job>;
  permissions?: Record<string, string>;
};

const DIRECTORY = new URL('../../../.github/workflows/', import.meta.url);
const GITHUB = new URL('../../../.github/', import.meta.url);
// zizmor's minimum for `cooldown.default-days` (its `dependabot-cooldown` audit); Dependabot's own
// default is 3 days.
const MIN_COOLDOWN_DAYS = 7;
// GitHub's default is 360 minutes; every job here finishes in a fraction of an hour.
const MAX_TIMEOUT_MINUTES = 60;
const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/u;
// Only pull requests are cancelled when superseded; a push to main always runs to the end.
// eslint-disable-next-line no-template-curly-in-string -- a GitHub expression, not a template
const PR_ONLY = "${{ github.event_name == 'pull_request' }}";

const entries = await readdir(DIRECTORY);
const names = entries.filter((name) => /\.ya?ml$/u.test(name)).toSorted();
const workflows = await Promise.all(
  names.map(async (name) => ({
    name,
    workflow: parse(await readFile(new URL(name, DIRECTORY), 'utf8')) as Workflow,
  })),
);
const byName = new Map(workflows.map(({ name, workflow }) => [name, workflow]));
const jobs = workflows.flatMap(({ name, workflow }) =>
  Object.entries(workflow.jobs).map(([job, body]) => ({ body, job: `${name} ${job}` })),
);
const steps = jobs.flatMap(({ body, job }) => (body.steps ?? []).map((step) => ({ job, step })));
const actionSteps = steps.filter(({ step }) => step.uses !== undefined);

describe('every workflow', () => {
  it.each(workflows)('$name grants read-only contents at the top level', ({ workflow }) => {
    expect.hasAssertions();
    expect(workflow.permissions).toStrictEqual({ contents: 'read' });
  });

  it.each(jobs)('$job has its own timeout', ({ body }) => {
    expect.hasAssertions();
    expect(body['timeout-minutes']).toBeGreaterThan(0);
    expect(body['timeout-minutes']).toBeLessThanOrEqual(MAX_TIMEOUT_MINUTES);
  });

  it.each(actionSteps)('$job pins $step.uses to a commit', ({ step }) => {
    expect.hasAssertions();
    expect(step.uses).toMatch(PINNED);
  });

  it.each(steps.filter(({ step }) => step.uses?.startsWith('actions/checkout@') === true))(
    '$job leaves no credential in its checkout',
    ({ step }) => {
      expect.hasAssertions();
      expect(step.with?.['persist-credentials']).toBe(false);
    },
  );
});

describe('cancelling superseded runs', () => {
  it.each(['ci.yml', 'skill-audit.yml', 'workflow-audit.yml'])(
    '%s cancels a superseded pull request run, never a push to main',
    (name) => {
      expect.hasAssertions();
      expect(byName.get(name)?.concurrency).toStrictEqual({
        'cancel-in-progress': PR_ONLY,
        // eslint-disable-next-line no-template-curly-in-string -- GitHub expressions
        group: '${{ github.workflow }}-${{ github.ref }}',
      });
    },
  );

  it('never cancels a release part-way', () => {
    expect.hasAssertions();
    expect(byName.get('release.yml')?.concurrency).toBeUndefined();
  });
});

describe('the release workflow', () => {
  const setups = Object.values(byName.get('release.yml')?.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .filter((step) => step.uses?.startsWith('actions/setup-node@') === true);

  it('sets up node at least once', () => {
    expect.hasAssertions();
    expect(setups.length).toBeGreaterThan(0);
  });

  it.each(setups)('restores no package cache', (step) => {
    expect.hasAssertions();
    expect(step.with?.['package-manager-cache']).toBe(false);
    expect(step.with?.['cache']).toBeUndefined();
  });
});

type Dependabot = {
  updates: { 'package-ecosystem': string; cooldown?: { 'default-days'?: number } }[];
};
type ZizmorConfig = { rules?: Record<string, { disable?: boolean }> };

const dependabot = parse(await readFile(new URL('dependabot.yml', GITHUB), 'utf8')) as Dependabot;
const zizmorConfig = parse(await readFile(new URL('zizmor.yml', GITHUB), 'utf8')) as ZizmorConfig;

describe('the Dependabot version updates', () => {
  const updates = dependabot.updates.map((update) => ({
    days: update.cooldown?.['default-days'],
    ecosystem: update['package-ecosystem'],
  }));

  it.each(updates)('for $ecosystem wait a week before proposing a new release', ({ days }) => {
    expect.hasAssertions();
    expect(days).toBeGreaterThanOrEqual(MIN_COOLDOWN_DAYS);
  });

  it('keeps zizmor’s cooldown audit on', () => {
    expect.hasAssertions();
    expect(zizmorConfig.rules?.['dependabot-cooldown']?.disable).toBeUndefined();
  });
});

describe('the workflow audit', () => {
  const runs = Object.values(byName.get('workflow-audit.yml')?.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .flatMap((step) => (step.run?.includes('zizmor') === true ? [step.run] : []));

  it('fails on a workflow or config file zizmor cannot parse, instead of skipping it', () => {
    expect.hasAssertions();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatch(/ --strict-collection /u);
  });
});
