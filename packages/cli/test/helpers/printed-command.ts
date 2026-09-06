import type { CliContext } from '../../src/context.ts';
import { SpawnRunner } from '@kaisers-io/refs-core';
import type { StructureReport } from '../../src/commands/drift-report.ts';
import { access } from 'node:fs/promises';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { driftLines } from '../../src/commands/drift-report.ts';
import { expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { shellQuote } from '../../src/shell-quote.ts';

// Running a command the tool PRINTED, through a real shell.
//
// The shell is the point. Three bugs have now hidden behind not using one: a hand-built argv
// passed a literal `<ref>` straight through, where a shell reads it as an input redirection; a
// splitter that knew only single quotes turned `--description "<what it is>"` into three tokens,
// so the substitution never fired and the CLI was handed nonsense; and that same splitter mangled
// `shellQuote`'s own output for a value containing a quote — `'packages/o'\\''brien'` came back as
// `packages/obrien` where `/bin/sh` gives `packages/o'brien`.
//
// Each fix made the parser less wrong. Deleting the parser makes the question moot: `sh -c` does
// the word splitting, which is what the printed command has to survive in the first place.

const LAST = -1;
const SUCCESS = 0;

/** The `refs edit <key>` prefix of a repair command, which is where a `<ref>` placeholder used to
 * sit — a shell reads that as an input redirection. */
const COMMAND_PREFIX_LENGTH = 3;

/** The one part of the printed command a finding deliberately leaves to the caller. */
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

const BUNDLE = fileURLToPath(new URL('../../dist/refs.mjs', import.meta.url));

/** The built bundle, built on demand.
 *
 * A shell cannot run the TypeScript entry: it resolves `@kaisers-io/refs-core` through the
 * workspace symlink under `node_modules`, and Node does not strip types there — the process exits
 * with no output, which is how this first failed on the floor interpreter while passing locally.
 * The bundle has no such imports, and is what actually ships.
 *
 * Built here rather than assumed, because `pnpm check` does not build: skipping the test when the
 * bundle is absent would make it silently vacuous, which is the failure mode this whole helper
 * exists to avoid. One build, memoized across the suite. */
// eslint-disable-next-line init-declarations -- the point is that it is unset until first use
let building: Promise<string> | undefined;

const buildBundle = async (): Promise<string> => {
  try {
    await access(BUNDLE);
    return BUNDLE;
  } catch {
    const built = await new SpawnRunner().run('pnpm', ['--filter', '@kaisers-io/refs', 'build'], {
      cwd: fileURLToPath(new URL('../../../..', import.meta.url)),
    });
    expect(built.exitCode, `pnpm build failed: ${built.stderr}`).toBe(SUCCESS);
    return BUNDLE;
  }
};

const cliBundle = (): Promise<string> => {
  building ??= buildBundle();
  return building;
};

/** The full `sh -c` line: the environment as a prefix (which is what a person pasting the command
 * would type, and what the runner cannot pass otherwise), `refs` pointed at the CLI entry, and the
 * description substituted into the placeholder's own quotes. */
const shellLine = (
  printed: string,
  args: { bundle: string; description: string; env: Record<string, string | undefined> },
): string => {
  const { bundle, description, env } = args;
  const prefix = Object.entries(env)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${shellQuote(value ?? '')}`)
    .join(' ');
  const command = printed
    .replace(`"${PLACEHOLDER}"`, shellQuote(description))
    .replace(/^refs /u, `node ${shellQuote(bundle)} `);
  return `${prefix} ${command} --json`;
};

/** Runs the repair command a finding printed, through `sh -c`, VERBATIM — only the description
 * placeholder is substituted, which is the one part the finding leaves to the caller.
 *
 * The substitution happens in the STRING, before the shell sees it, and the placeholder carries
 * its own quotes (`"<what it is>"`) so the replacement is quoted in turn rather than pasted bare. */
const runPrintedRepair = async (args: {
  description: string;
  env: Record<string, string | undefined>;
  line: string;
}): Promise<string> => {
  const marker = 'To register it: ';
  const printed = args.line.slice(args.line.indexOf(marker) + marker.length);
  expect(printed).toContain(`"${PLACEHOLDER}"`);
  const result = await new SpawnRunner().run('sh', [
    '-c',
    shellLine(printed, {
      bundle: await cliBundle(),
      description: args.description,
      env: args.env,
    }),
  ]);
  // The command has to have SUCCEEDED. Without this the test passed while the CLI rejected the
  // arguments outright, because the assertion that followed held either way.
  expect(result.exitCode).toBe(SUCCESS);
  const envelope = JSON.parse(result.stdout.trim().split('\n').at(LAST) ?? '{}') as {
    error?: unknown;
    ok?: boolean;
  };
  expect(envelope.error).toBeUndefined();
  expect(envelope.ok).toBe(true);
  return printed;
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

export { COMMAND_PREFIX_LENGTH, PLACEHOLDER, repairLineFor, resolveStatus, runPrintedRepair };
