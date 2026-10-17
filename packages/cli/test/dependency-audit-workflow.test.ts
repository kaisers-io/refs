import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readFile } from 'node:fs/promises';

type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
type Job = { 'timeout-minutes'?: number; permissions?: Record<string, string>; steps: Step[] };
type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
};

const file = new URL('../../../.github/workflows/dependency-audit.yml', import.meta.url);
const workflow = parse(await readFile(file, 'utf8')) as Workflow;
const { audit } = workflow.jobs;

describe('complete lockfile audit workflow', () => {
  it('checks PRs, main pushes and a weekly advisory refresh', () => {
    expect.hasAssertions();
    expect(Object.keys(workflow.on)).toContain('pull_request');
    expect(Object.keys(workflow.on)).toContain('workflow_dispatch');
    expect(workflow.on['push']).toStrictEqual({ branches: ['main'] });
    expect(workflow.on['schedule']).toStrictEqual([{ cron: '23 8 * * 1' }]);
  });

  it('keeps the scanner read-only and bounded', () => {
    expect.hasAssertions();
    expect(workflow.permissions).toStrictEqual({ contents: 'read' });
    expect(audit?.permissions).toBeUndefined();
    expect(audit?.['timeout-minutes']).toBeGreaterThan(0);
  });

  it('uses the repository pnpm pin without installing project dependencies', () => {
    expect.hasAssertions();
    const setup = audit?.steps.find((step) => step.uses?.startsWith('pnpm/action-setup@'));
    expect(setup?.uses).toMatch(/^pnpm\/action-setup@[a-f\d]{40}$/u);
    expect(setup?.with).toBeUndefined();
    expect(audit?.steps.filter((step) => step.run).map((step) => step.run)).toStrictEqual([
      'pnpm audit --audit-level high',
    ]);
  });

  it('keeps checkout credentials out of the audit process', () => {
    expect.hasAssertions();
    const checkout = audit?.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['persist-credentials']).toBe(false);
  });
});
