import type { CliContext } from '../../src/context.ts';
import type { StructureReport } from '../../src/commands/drift-report.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { driftLines } from '../../src/commands/drift-report.ts';
import { expect } from 'vitest';

// Running a command the tool PRINTED, rather than one the test rebuilt from the same parts.
//
// The distinction has now hidden two real bugs. A hand-built argv passed a literal `<ref>`
// placeholder straight through, where a shell reads it as an input redirection. And a splitter
// that knew only single quotes turned `--description "<what it is>"` into three tokens, so the
// substitution never fired and the CLI was handed nonsense — with nothing asserting it had
// worked, because the assertion that followed held either way.

const LAST = -1;

type SplitState = { argv: string[]; current: string; quote: string; started: boolean };

const QUOTES = new Set(["'", '"']);

/** One character of the split. BOTH quote characters matter: the command single-quotes its
 * interpolated values but writes the description placeholder as `"<what it is>"`. */
const step = (state: SplitState, char: string): SplitState => {
  if (state.quote !== '') {
    return char === state.quote
      ? { ...state, quote: '' }
      : { ...state, current: state.current + char };
  }
  if (QUOTES.has(char)) {
    return { ...state, quote: char, started: true };
  }
  if (char !== ' ') {
    return { ...state, current: state.current + char };
  }
  const done = state.started || state.current.length > 0;
  return {
    argv: done ? [...state.argv, state.current] : state.argv,
    current: '',
    quote: '',
    started: false,
  };
};

/** Splits a printed command into argv the way a POSIX shell would. */
const splitCommand = (command: string): string[] => {
  const end = [...command].reduce<SplitState>((state, char) => step(state, char), {
    argv: [],
    current: '',
    quote: '',
    started: false,
  });
  return end.started || end.current.length > 0 ? [...end.argv, end.current] : end.argv;
};

/** The `refs edit <key>` prefix of a repair command, which is where a `<ref>` placeholder used to
 * sit — a shell reads that as an input redirection, so the line could not run as printed. */
const COMMAND_PREFIX_LENGTH = 3;

/** The one part of the printed command the finding deliberately leaves to the caller. */
const PLACEHOLDER = '<what it is>';

/** Finds the printed repair line for one package, or throws — an absent line is a broken fixture,
 * not a branch worth asserting on. */
const repairLineFor = (report: StructureReport | undefined, key: string, name: string): string => {
  const line = driftLines(report ?? { status: 'ok' }, key).find((text) => text.includes(name));
  if (line === undefined) {
    throw new Error(`expected a drift line mentioning '${name}'`);
  }
  return line;
};

/** Runs the repair command a finding printed, VERBATIM — only the description placeholder is
 * filled in, which is the one part the finding deliberately leaves to the caller. */
const runPrintedRepair = async (
  ctx: CliContext,
  args: { description: string; line: string; stdout: string[] },
): Promise<string[]> => {
  const marker = 'To register it: ';
  const command = args.line.slice(args.line.indexOf(marker) + marker.length);
  const argv = splitCommand(command);
  // The placeholder has to be ONE token for this to fire — which is the whole point of splitting
  // the printed string the way a shell does rather than trusting it to look how we expect.
  expect(argv).toContain(PLACEHOLDER);
  const filled = argv.map((arg) => (arg === PLACEHOLDER ? args.description : arg));
  const { run } = await import('../../src/main.ts');
  args.stdout.length = 0;
  // `refs …` as printed becomes `node refs …` as commander expects.
  await run(ctx, ['node', ...filled, '--json']);
  // The command has to have SUCCEEDED. Without this the test passed while the CLI rejected the
  // arguments outright, because the assertion that followed held either way.
  expectSucceeded(args.stdout);
  return filled;
};

/** Asserts the last envelope on stdout reports success. Without this the repair test passed while
 * the CLI rejected the arguments outright, because the assertion that followed held either way. */
const expectSucceeded = (stdout: readonly string[]): void => {
  const envelope = JSON.parse(stdout.at(LAST) ?? '{}') as {
    error?: { code: string };
    ok?: boolean;
  };
  expect(envelope.error).toBeUndefined();
  expect(envelope.ok).toBe(true);
};

/** Resolves `name` through the real command and returns the package's verification status. */
const resolveStatus = async (
  ctx: CliContext,
  stdout: string[],
  name: string,
): Promise<string | undefined> => {
  stdout.length = 0;
  const { run } = await import('../../src/main.ts');
  await run(ctx, ['node', 'refs', 'resolve', name, '--json']);
  const envelope = JSON.parse(stdout.at(LAST) ?? '{}') as {
    data?: { package?: { status: string } };
  };
  return envelope.data?.package?.status;
};

export {
  COMMAND_PREFIX_LENGTH,
  PLACEHOLDER,
  repairLineFor,
  resolveStatus,
  runPrintedRepair,
  splitCommand,
};
