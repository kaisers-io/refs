import type { Config, FakeRunner, RefsHome } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { SCHEMA_VERSION, resolveHome, zConfig } from '@kaisers-io/refs-core';
import { initHome, parseLastEnvelope } from './add-support.ts';
import type { CliContext } from '../../src/context.ts';
import { expect } from 'vitest';
import { run } from '../../src/main.ts';
import { testContext } from './context.ts';

// Shared scaffolding for the `refs doctor` test suite (`doctor.test.ts`, `doctor-checkouts.test.ts`,
// `doctor-orphans.test.ts`, `doctor-ssh.test.ts`, `doctor-ssh-timeout.test.ts`) — kept separate
// purely to keep each of those files under the repo's 300-line oxlint cap and each individual test
// under its max-statements cap.
// `withResetExitCode`/`withTempHome` are re-exported directly from `add-support.ts` (below) so every
// doctor test file only needs this one helper import alongside `ref-fixtures.ts`. Every doctor test
// uses the concrete `FakeRunner` returned by `setupInitializedHome` (never `ctx.runner`'s narrower
// `Runner` interface type) to script responses, mirroring `show.test.ts`'s own `runner.expect(...)`
// usage.

type DoctorTestHome = {
  ctx: CliContext;
  home: RefsHome;
  runner: FakeRunner;
  stdout: string[];
};

/** `testContext()` + `REFS_HOME` + a real `refs init` (which never touches the injected `Runner`,
 * so this stays compatible with every doctor test's later `runner.expect(...)` scripting) — the
 * setup every doctor test case needs, collapsed into one call so each test stays under the repo's
 * `max-statements` cap. */
const setupInitializedHome = async (homeDir: string): Promise<DoctorTestHome> => {
  const { ctx, runner, stdout } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  await initHome(ctx);
  return { ctx, home: resolveHome(ctx.env), runner, stdout };
};

const GIT_VERSION_STDOUT = 'git version 2.50.1';

/** Queues the scripted response for `checkGit`'s `git --version` probe — every doctor test needs
 * exactly one of these queued first, since `runStepsInOrder` runs the checks strictly in the
 * spec's own order (`git` is always first). */
const expectGitVersion = (runner: FakeRunner): void => {
  runner.expect('git --version', { stdout: GIT_VERSION_STDOUT });
};

type CheckResultLike = {
  detail: string;
  name: string;
  status: string;
};

type DoctorEnvelope = {
  data: { checks: CheckResultLike[] };
  ok: boolean;
};

const runDoctorJson = async (
  ctx: CliContext,
  stdout: readonly string[],
): Promise<DoctorEnvelope> => {
  await run(ctx, ['node', 'refs', 'doctor', '--json']);
  return parseLastEnvelope(stdout) as DoctorEnvelope;
};

const findCheck = (envelope: DoctorEnvelope, name: string): CheckResultLike | undefined =>
  envelope.data.checks.find((check) => check.name === name);

/** Asserts one check's `status` (and, optionally, that its `detail` contains a substring) in a
 * single call — collapses the `findCheck` + one-or-two `expect(...)` calls every test case would
 * otherwise repeat, keeping each test's own statement count under the repo's `max-statements` cap. */
const expectCheck = (
  envelope: DoctorEnvelope,
  name: string,
  expected: { detailContains?: string; status: string },
): void => {
  const check = findCheck(envelope, name);
  expect(check?.status).toBe(expected.status);
  if (expected.detailContains !== undefined) {
    expect(check?.detail).toContain(expected.detailContains);
  }
};

const HTTPS_REF_ENTRY = {
  default_branch: 'main',
  description: 'Alpha lib',
  tag_format: 'v{version}',
  url: 'https://github.com/acme/alpha',
};

const buildSshRefEntry = (host: string): Record<string, unknown> => ({
  default_branch: 'main',
  description: 'Ssh lib',
  tag_format: 'v{version}',
  url: `git@${host}:acme/ssh-repo.git`,
});

const TEST_CLI_VERSION = '0.0.0-test';

/** Builds a `Config` for `checkSshAuth`-only suites, which call it directly rather than driving
 * the full `run(ctx, [...])` CLI pipeline, so no `refs init`/temp home is needed — just this
 * `Config` and a scripted `FakeRunner`. Shared by `doctor-ssh.test.ts` and its sibling split-out
 * ssh suites so each individual file stays under the repo's 300-line oxlint cap. */
const buildSshConfig = (refs: Record<string, unknown>): Config =>
  zConfig.parse({
    meta: { cli_version: TEST_CLI_VERSION, schema_version: SCHEMA_VERSION },
    refs,
    settings: {},
  });

export {
  buildSshConfig,
  buildSshRefEntry,
  expectCheck,
  expectGitVersion,
  findCheck,
  HTTPS_REF_ENTRY,
  runDoctorJson,
  setupInitializedHome,
};
export { withResetExitCode, withTempHome } from './add-support.ts';
export type { CheckResultLike, DoctorEnvelope, DoctorTestHome };
