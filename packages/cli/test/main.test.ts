import { buildProgram, run, runProgram } from '../src/main.ts';
import { describe, expect, it } from 'vitest';
import { EXIT } from '@kaisers-io/refs-core';
import { testContext } from './helpers/context.ts';

const NO_LINES = 0;
const ONE_LINE = 1;

// `run`/`runProgram` set `process.exitCode` as a real side effect on the actual test-runner
// Process (per the "only `process.exitCode`, never `process.exit()`" contract) — snapshot and
// Restore it around every case so one test's exit code never leaks into the next test, or into
// Vitest's own process exit code.
const withResetExitCode = async (exercise: () => Promise<void>): Promise<void> => {
  const original = process.exitCode;
  process.exitCode = undefined;
  try {
    await exercise();
  } finally {
    process.exitCode = original;
  }
};

// Pulls the sole element out of a captured-output array — kept out of the `it` bodies below so
// The `if` here never counts as a conditional inside a test (vitest/no-conditional-in-test).
const soleLine = (lines: readonly string[]): string => {
  const [line] = lines;
  if (line === undefined) {
    throw new Error('expected exactly one output line, got none');
  }
  return line;
};

type UsageEnvelope = {
  error: { code: string; message: string };
  ok: boolean;
};

// Typed parse of a single `--json` error-envelope line — kept out of the `it` body below purely to
// stay under the repo's max-statements/max-expects caps.
const parseUsageEnvelope = (line: string): UsageEnvelope => JSON.parse(line) as UsageEnvelope;

// Envelope-contract tests (spec §4 HIGH-fix): every Commander parsing failure class must still
// Come out through `emitError`'s single-line json envelope when `--json` was requested, even
// Though parsing failed before the program's own action code ever ran. Registry is empty in this
// Scaffold (no commands registered yet — Task 15+), so these only exercise Commander's own
// help/version/unknown-option/missing-argument failure classes, never a thrown domain error.
describe('cli envelope contract: help and version', () => {
  it('--help exits 0 and writes usage text to stdout', async () => {
    expect.hasAssertions();
    await withResetExitCode(async () => {
      const { ctx, stderr, stdout } = testContext();
      await run(ctx, ['node', 'refs', '--help']);
      expect(process.exitCode).toBe(EXIT.OK);
      expect(stdout.join('\n')).toContain('Usage:');
      expect(stderr).toHaveLength(NO_LINES);
    });
  });

  it('--version exits 0', async () => {
    expect.hasAssertions();
    await withResetExitCode(async () => {
      const { ctx, stderr } = testContext();
      await run(ctx, ['node', 'refs', '--version']);
      expect(process.exitCode).toBe(EXIT.OK);
      expect(stderr).toHaveLength(NO_LINES);
    });
  });
});

describe('cli envelope contract: parsing failures', () => {
  it('unknown option in human mode exits 2 and writes a single "refs:" stderr line', async () => {
    expect.hasAssertions();
    await withResetExitCode(async () => {
      const { ctx, stdout, stderr } = testContext();
      await run(ctx, ['node', 'refs', '--definitely-not-a-flag']);
      expect(process.exitCode).toBe(EXIT.USAGE);
      expect(stderr).toHaveLength(ONE_LINE);
      expect(soleLine(stderr)).toMatch(/^refs:/u);
      expect(stdout).toHaveLength(NO_LINES);
    });
  });

  it('unknown option in json mode exits 2 with exactly one parseable envelope line', async () => {
    expect.hasAssertions();
    await withResetExitCode(async () => {
      const { ctx, stdout, stderr } = testContext();
      await run(ctx, ['node', 'refs', '--json', '--definitely-not-a-flag']);
      expect(process.exitCode).toBe(EXIT.USAGE);
      expect(stdout).toHaveLength(ONE_LINE);
      expect(stderr).toHaveLength(NO_LINES);
      const parsed: unknown = JSON.parse(soleLine(stdout));
      expect(parsed).toMatchObject({ error: { code: 'usage' }, ok: false });
    });
  });

  it('missing required argument in json mode exits 2 with an envelope', async () => {
    expect.hasAssertions();
    await withResetExitCode(async () => {
      const { ctx, stdout, stderr } = testContext();
      const program = buildProgram(ctx);
      program.command('probe <thing>');
      await runProgram(ctx, program, ['node', 'refs', '--json', 'probe']);
      expect(process.exitCode).toBe(EXIT.USAGE);
      expect(stdout).toHaveLength(ONE_LINE);
      expect(stderr).toHaveLength(NO_LINES);
      const parsed: unknown = JSON.parse(soleLine(stdout));
      expect(parsed).toMatchObject({ error: { code: 'usage' }, ok: false });
    });
  });
});

// Finding 1 (review round 1): a bare positional at the root — e.g. `refs status` — with the
// Registry still empty must not be silently accepted; it has to raise `commander.excessArguments`
// And flow through the same usage-error envelope as every other Commander parsing failure class
// Above, in both json and human mode.
describe('cli envelope contract: stray positionals at the root (finding 1)', () => {
  it('stray positional in json mode exits 2 with a single envelope line', async () => {
    expect.hasAssertions();
    await withResetExitCode(async () => {
      const { ctx, stdout, stderr } = testContext();
      await run(ctx, ['node', 'refs', '--json', 'status']);
      expect(process.exitCode).toBe(EXIT.USAGE);
      expect(stdout).toHaveLength(ONE_LINE);
      expect(stderr).toHaveLength(NO_LINES);
      const parsed: unknown = JSON.parse(soleLine(stdout));
      expect(parsed).toMatchObject({ error: { code: 'usage' }, ok: false });
    });
  });

  it('stray positional in human mode exits 2 with a single "refs:" stderr line', async () => {
    expect.hasAssertions();
    await withResetExitCode(async () => {
      const { ctx, stdout, stderr } = testContext();
      await run(ctx, ['node', 'refs', 'status']);
      expect(process.exitCode).toBe(EXIT.USAGE);
      expect(stderr).toHaveLength(ONE_LINE);
      expect(soleLine(stderr)).toMatch(/^refs:/u);
      expect(stdout).toHaveLength(NO_LINES);
    });
  });
});

// Finding 2 (review round 1): `isJsonMode` must stop scanning at the `--` terminator — a `--json`
// Token that only appears as a literal operand after `--` must not flip the renderer into json
// Mode, and vice versa a `--json` token before the terminator still must.
describe('cli envelope contract: -- terminator (finding 2)', () => {
  it('a literal "--json" operand after -- does not trigger json rendering', async () => {
    expect.hasAssertions();
    await withResetExitCode(async () => {
      const { ctx, stdout, stderr } = testContext();
      await run(ctx, ['node', 'refs', '--', '--json']);
      expect(process.exitCode).toBe(EXIT.USAGE);
      expect(stderr).toHaveLength(ONE_LINE);
      expect(soleLine(stderr)).toMatch(/^refs:/u);
      expect(stdout).toHaveLength(NO_LINES);
    });
  });

  it('"--json" before -- still triggers json rendering even with a later --', async () => {
    expect.hasAssertions();
    await withResetExitCode(async () => {
      const { ctx, stdout, stderr } = testContext();
      await run(ctx, ['node', 'refs', '--json', 'status', '--', 'ignored']);
      expect(process.exitCode).toBe(EXIT.USAGE);
      expect(stdout).toHaveLength(ONE_LINE);
      expect(stderr).toHaveLength(NO_LINES);
      const parsed: unknown = JSON.parse(soleLine(stdout));
      expect(parsed).toMatchObject({ error: { code: 'usage' }, ok: false });
    });
  });
});

// Finding 3 (review round 1): an unexpected (non-Commander) error escaping `parseAsync` must
// Still honor `--verbose` — currently `handleUnexpectedError` hardcodes `verbose: false`, so the
// Global option's documented promise ("stack traces on error") silently never applies to this
// Path. Drives a throwaway action-throwing probe command, mirroring the missing-argument
// Probe-seam pattern above, since the empty registry has no reachable real command yet.
describe('cli envelope contract: --verbose on unexpected errors (finding 3)', () => {
  it('an unexpected thrown error with --verbose renders a stack trace', async () => {
    expect.hasAssertions();
    await withResetExitCode(async () => {
      const { ctx, stderr } = testContext();
      const program = buildProgram(ctx);
      program.command('probe').action(() => {
        throw new Error('boom');
      });
      await runProgram(ctx, program, ['node', 'refs', '--verbose', 'probe']);
      expect(process.exitCode).toBe(EXIT.UNEXPECTED);
      expect(stderr).toHaveLength(ONE_LINE);
      expect(soleLine(stderr)).toContain('at ');
    });
  });
});

// Task 14 gap: `--json` and `--verbose` combined on a Commander parsing failure (never a thrown
// `RefsError`) must still produce exactly one envelope, with the appended stack safely
// `JSON.stringify`d (its embedded newlines escaped to the two-character `\n` sequence) rather than
// breaking the single-line-on-stdout contract.
describe('cli envelope contract: --json + --verbose combined on a parse failure (Task 14 gap)', () => {
  it('unknown option embeds a JSON-escaped stack inside one envelope', async () => {
    expect.hasAssertions();
    await withResetExitCode(async () => {
      const { ctx, stdout } = testContext();
      await run(ctx, ['node', 'refs', '--json', '--verbose', '--definitely-not-a-flag']);
      expect(process.exitCode).toBe(EXIT.USAGE);
      expect(stdout).toHaveLength(ONE_LINE);
      const rawLine = soleLine(stdout);
      expect(rawLine).toContain(String.raw`\n`);
      const envelope = parseUsageEnvelope(rawLine);
      expect(envelope).toMatchObject({ error: { code: 'usage' }, ok: false });
      expect(envelope.error.message).toMatch(/\n[\s\S]*at /u);
    });
  });
});
