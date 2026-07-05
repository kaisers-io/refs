import { ExecaRunner, readConfig, readState, zProposal } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { Proposal, RefsHome } from '@kaisers-io/refs-core';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { CliContext } from '../../src/context.ts';
import { expect } from 'vitest';
import { join } from 'node:path';
import { run } from '../../src/main.ts';
import { testContext } from './context.ts';
import { tmpdir } from 'node:os';

// Shared scaffolding + assertion helpers for `add.test.ts`'s real-git integration suite — kept
// separate purely to keep that file under the repo's 300-line oxlint cap and each individual test
// under its max-statements cap.

const LAST_INDEX = -1;
const NO_ITEMS = 0;

const withTempHome = async (exercise: (homeDir: string) => Promise<void>): Promise<void> => {
  const homeDir = await mkdtemp(join(tmpdir(), 'refs-add-test-'));
  try {
    await exercise(homeDir);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
};

// `run`/`runProgram` set `process.exitCode` as a real side effect on the actual test-runner
// process — snapshot and restore it around every case, mirroring `init.test.ts`'s helper, so one
// test's exit code never leaks into the next.
const withResetExitCode = async (exercise: () => Promise<void>): Promise<void> => {
  const original = process.exitCode;
  process.exitCode = undefined;
  try {
    await exercise();
  } finally {
    process.exitCode = original;
  }
};

// A `CliContext` wired to a real git binary (`ExecaRunner`) instead of the scripted `FakeRunner` —
// `add`'s dry-run/finalize flows shell out to real `git clone`/`git tag`/etc. against `file://`
// fixtures, which `FakeRunner` can't script realistically. `REFS_ALLOW_FILE_URLS=1` is required for
// `canonicalizeGitUrl` to accept the fixture's `file://` url at all (real remotes are https/ssh
// only; `file://` is a test-only escape hatch documented in the task brief).
const realContextFor = (
  homeDir: string,
): { ctx: CliContext; stderr: string[]; stdout: string[] } => {
  const { ctx, stderr, stdout } = testContext();
  ctx.runner = new ExecaRunner();
  ctx.env['REFS_HOME'] = homeDir;
  ctx.env['REFS_ALLOW_FILE_URLS'] = '1';
  return { ctx, stderr, stdout };
};

const initHome = (ctx: CliContext): Promise<void> => run(ctx, ['node', 'refs', 'init']);

/** Parses the LAST emitted json envelope line (rather than requiring exactly one, like
 * `init.test.ts`'s `parseSoleEnvelope`) — these tests often run `init` and one or more `add`
 * invocations against the same `ctx`, so earlier commands' envelopes accumulate in `stdout` too. */
const parseLastEnvelope = (stdout: readonly string[]): unknown => {
  const line = stdout.at(LAST_INDEX);
  if (line === undefined) {
    throw new Error('expected at least one json envelope line, got none');
  }
  return JSON.parse(line);
};

/** Runs `refs add <source> --dry-run --json` and returns the parsed+validated `Proposal` — the
 * common first step of both the (a) dry-run and (b) finalize-a-proposal test cases. */
const runAddDryRunJson = async (
  ctx: CliContext,
  stdout: string[],
  source: string,
): Promise<Proposal> => {
  await run(ctx, ['node', 'refs', 'add', source, '--dry-run', '--json']);
  const envelope = parseLastEnvelope(stdout) as { data: unknown };
  return zProposal.parse(envelope.data);
};

/** Writes `completed` (a filled-in proposal) to `<homeDir>/proposal.json` and runs
 * `refs add --proposal <file> --json` against it. */
const finalizeViaProposalFile = async (
  ctx: CliContext,
  homeDir: string,
  completed: unknown,
): Promise<void> => {
  const proposalPath = join(homeDir, 'proposal.json');
  await writeFile(proposalPath, JSON.stringify(completed));
  await run(ctx, ['node', 'refs', 'add', '--proposal', proposalPath, '--json']);
};

// Also asserts `effective_clone_mode` is already `'full'` right after the dry-run's own clone
// (see `expectFinalizedState`'s comment) — proving `writePendingProposal` captures the real clone
// result rather than leaving it to be guessed later at finalize time.
const expectPendingProposal = async (home: RefsHome, key: string): Promise<void> => {
  const state = await readState(home);
  const refState = state.refs[key];
  expect(refState).toBeDefined();
  expect(refState?.pending_proposal_at).toBeDefined();
  expect(refState?.effective_clone_mode).toBe('full');
};

const expectPackagesWithDescriptions = async (
  home: RefsHome,
  key: string,
  expectedCount: number,
): Promise<void> => {
  const config = await readConfig(home);
  const entry = config.refs[key];
  const packages = entry?.packages;
  expect(packages).toBeDefined();
  const values = Object.values(packages ?? {});
  expect(values).toHaveLength(expectedCount);
  const missingDescription = values.filter((pkg) => pkg.description.length === NO_ITEMS);
  expect(missingDescription).toHaveLength(NO_ITEMS);
};

// `effective_clone_mode` must be `'full'` here even though the default config `clone_mode` setting
// is `'blobless'`: a plain `file://` fixture remote never honours `--filter=blob:none` (see
// `git/repo.ts#cloneRepo`'s documented fallback, established in Task 10), so this also proves the
// real clone result — not just the global setting — reaches state at finalize time.
const expectFinalizedState = async (home: RefsHome, key: string): Promise<void> => {
  const state = await readState(home);
  const refState = state.refs[key];
  expect(refState?.pending_proposal_at).toBeUndefined();
  expect(refState?.head_sha).toMatch(/^[0-9a-f]{40}$/u);
  expect(refState?.effective_clone_mode).toBe('full');
};

const expectNoPackagesTable = async (home: RefsHome, key: string): Promise<void> => {
  const config = await readConfig(home);
  expect(config.refs[key]?.packages).toBeUndefined();
};

export {
  expectFinalizedState,
  expectNoPackagesTable,
  expectPackagesWithDescriptions,
  expectPendingProposal,
  finalizeViaProposalFile,
  initHome,
  parseLastEnvelope,
  realContextFor,
  runAddDryRunJson,
  withResetExitCode,
  withTempHome,
};
