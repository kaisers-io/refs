import {
  EXIT,
  SpawnRunner,
  readConfig,
  readState,
  resolveHome,
  zProposal,
} from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { Proposal, RefsHome } from '@kaisers-io/refs-core';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { CliContext } from '../../src/context.ts';
import { expect } from 'vitest';
import { join } from 'node:path';
import { run } from '../../src/main.ts';
import { testContext } from './context.ts';
import { tmpdir } from 'node:os';

type ErrorEnvelope = {
  error?: { code: string; message: string };
  ok: boolean;
};

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

// A `CliContext` wired to a real git binary (`SpawnRunner`) instead of the scripted `FakeRunner` —
// `add`'s dry-run/finalize flows shell out to real `git clone`/`git tag`/etc. against `file://`
// fixtures, which `FakeRunner` can't script realistically. `REFS_ALLOW_FILE_URLS=1` is required for
// `canonicalizeGitUrl` to accept the fixture's `file://` url at all (real remotes are https/ssh
// only; `file://` is a test-only escape hatch documented in the task brief).
const realContextFor = (
  homeDir: string,
): { ctx: CliContext; stderr: string[]; stdout: string[] } => {
  const { ctx, stderr, stdout } = testContext();
  ctx.runner = new SpawnRunner();
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

/** Stubs `ctx.readStdin` to resolve with `completed` (a filled-in proposal, JSON-stringified) and
 * runs `refs add --proposal - --json` against it — the `readStdin '-'` branch (Task 16 gap)
 * mirrors `finalizeViaProposalFile` above but through the stdin seam instead of a real file. */
const finalizeViaStdinProposal = async (ctx: CliContext, completed: unknown): Promise<void> => {
  ctx.readStdin = () => Promise.resolve(JSON.stringify(completed));
  await run(ctx, ['node', 'refs', 'add', '--proposal', '-', '--json']);
};

// A hand-built `FinalProposal`-shaped object — every field `zFinalProposal` requires, notably
// `key` (envelope bodies never carry one). Used by the envelope-detection edge-case tests, which
// never need a real checkout: those cases are all rejected by `loadFinalProposal` before
// `runAddProposal` ever resolves `home` or checks out.
const validFinalProposal = (key: string): Record<string, unknown> => ({
  default_branch: 'main',
  description: 'A hand-built proposal.',
  key,
  packages: {},
  tag_format_candidate: 'v{version}',
  url: `https://${key}.git`,
});

type AddTestHarness = {
  ctx: CliContext;
  homeDir: string;
  stdout: string[];
};

/** Writes `body` to a proposal file, finalizes via `--proposal`, and asserts the common
 * validation-failure shape (exit 3, `ok: false`, `code: 'validation'`) — the three assertions
 * every envelope-detection edge case shares, returning the envelope so callers can add their own
 * message-specific assertions on top without re-deriving it. */
const runFinalizeExpectingValidationError = async (
  harness: AddTestHarness,
  body: unknown,
): Promise<ErrorEnvelope> => {
  const { ctx, homeDir, stdout } = harness;
  await finalizeViaProposalFile(ctx, homeDir, body);
  expect(process.exitCode).toBe(EXIT.VALIDATION);
  const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
  expect(envelope.ok).toBe(false);
  expect(envelope.error?.code).toBe('validation');
  return envelope;
};

/** Asserts none of `keys` were finalized into `config.refs` — used to prove a rejected proposal
 * file (e.g. a hybrid envelope/proposal that fails strict-schema validation) never reached the
 * config write path for either its top-level or nested proposal. */
const expectKeysAbsentFromConfig = async (ctx: CliContext, keys: string[]): Promise<void> => {
  const home = resolveHome(ctx.env);
  const config = await readConfig(home);
  for (const key of keys) {
    expect(config.refs[key]).toBeUndefined();
  }
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
  expectKeysAbsentFromConfig,
  expectNoPackagesTable,
  expectPackagesWithDescriptions,
  expectPendingProposal,
  finalizeViaProposalFile,
  finalizeViaStdinProposal,
  initHome,
  parseLastEnvelope,
  realContextFor,
  runAddDryRunJson,
  runFinalizeExpectingValidationError,
  validFinalProposal,
  withResetExitCode,
  withTempHome,
};
export type { ErrorEnvelope };
