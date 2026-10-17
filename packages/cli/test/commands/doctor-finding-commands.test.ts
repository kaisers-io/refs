import { addPackage, writeJson } from '../helpers/workspace-fixture.ts';
import { checkoutPath, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import {
  expectGitVersion,
  runDoctorJson,
  setupInitializedHome,
  withResetExitCode,
  withTempHome,
} from '../helpers/doctor-support.ts';
import { markCheckoutPresent, seedConfig } from '../helpers/ref-fixtures.ts';
import type { DoctorEnvelope } from '../helpers/doctor-support.ts';
import { join } from 'node:path';

// `findings` is what the skill routes an agent to for the candidate list, and it carried raw
// `name` and `path` with no command. The human `detail` has the shell-quoted command — but once a
// directory holds enough unregistered packages, the per-package line is replaced by a single count
// line, so in exactly the large-monorepo case the documents point at, `detail` carried no command
// at all and `findings` carried values that are not tame: a package name comes from the tracked
// repository's own manifest, and `zPackagePath` admits spaces, `$()` and backticks.
//
// Being verified against the checkout makes a value TRUE, not shell-safe.

const ALPHA_KEY = 'github.com/acme/alpha';
const ALPHA_URL = 'https://github.com/acme/alpha';
// Enough to pass the grouping threshold, so the human line collapses to a count.
const GROUPED_COUNT = 6;

type Finding = {
  decline?: string;
  name: string;
  path?: string;
  register?: string;
  status: string;
};

const findingsFor = (envelope: DoctorEnvelope): Finding[] => {
  const check = envelope.data.checks.find((entry) => entry.name === 'config-drift') as
    | { findings?: { packages: Finding[] }[] }
    | undefined;
  return check?.findings?.[0]?.packages ?? [];
};

const REF_ENTRY = {
  default_branch: 'main',
  description: 'Alpha lib',
  packages: { '@acme/kept': { description: 'Kept.', path: 'packages/kept' } },
  url: ALPHA_URL,
};

const writeMembers = (dest: string, members: readonly (readonly [string, string])[]): void => {
  writeJson(join(dest, 'package.json'), { workspaces: ['packages/*'] });
  addPackage(dest, 'packages/kept', { name: '@acme/kept', version: '1.0.0' });
  for (const [dir, name] of members) {
    addPackage(dest, `packages/${dir}`, { name, version: '1.0.0' });
  }
};

const scriptCheckoutGit = (
  setup: Awaited<ReturnType<typeof setupInitializedHome>>,
  dest: string,
): void => {
  expectGitVersion(setup.runner);
  setup.runner.expect(
    'git config --local --get core.hooksPath',
    { stdout: setup.home.hooksDir },
    { cwd: dest },
  );
  setup.runner.expect('git status --porcelain', { stdout: '' }, { cwd: dest });
};

const seedCheckout = async (
  homeDir: string,
  members: readonly (readonly [string, string])[],
): Promise<Awaited<ReturnType<typeof setupInitializedHome>>> => {
  const setup = await setupInitializedHome(homeDir);
  await seedConfig(setup.home, { [ALPHA_KEY]: REF_ENTRY });
  const dest = checkoutPath(setup.home, zRefKey.parse(ALPHA_KEY));
  await markCheckoutPresent(dest, { hooksDir: setup.home.hooksDir, url: ALPHA_URL });
  writeMembers(dest, members);
  scriptCheckoutGit(setup, dest);
  return setup;
};

describe('refs doctor --json: an unregistered package with a hostile name', () => {
  it('carries its repair commands, quoted, beside the raw values', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await seedCheckout(homeDir, [['a b', "@acme/c$(id)'x"]]);

        const [finding] = findingsFor(await runDoctorJson(setup.ctx, setup.stdout));

        // The raw values stay — a caller that wants them still gets them.
        expect(finding?.name).toBe("@acme/c$(id)'x");
        expect(finding?.path).toBe('packages/a b');
        // And the command is quoted, so nothing has to assemble one.
        expect(finding?.decline).toBe(
          `refs edit --package='@acme/c$(id)'\\''x' --decline --path='packages/a b' '${ALPHA_KEY}'`,
        );
        // Single-quoted like every other value: in double quotes a `$(…)` the caller substitutes
        // for the placeholder would be expanded by their own shell before refs ever saw it, in the
        // one part of the line refs tells them to edit.
        expect(finding?.register).toContain("--description='<what it is>'");
        expect(finding?.register).not.toContain('--description="');
      }),
    );
  });
});

describe('refs doctor --json: the case the human output groups away', () => {
  it('still carries a command per candidate', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const members = Array.from({ length: GROUPED_COUNT }, (_value, index) => {
          const suffix = String(index);
          return [`m${suffix}`, `@acme/m${suffix}`] as const;
        });
        const setup = await seedCheckout(homeDir, members);

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        // The human detail collapsed to a count, which is the point: it names no package.
        const detail = envelope.data.checks.find((entry) => entry.name === 'config-drift')?.detail;
        expect(detail).toContain('unregistered package(s) the configuration does not have');
        expect(detail).not.toContain('--decline');
        const findings = findingsFor(envelope);
        expect(findings).toHaveLength(GROUPED_COUNT);
        expect(findings.every((finding) => finding.decline !== undefined)).toBe(true);
      }),
    );
  });
});
