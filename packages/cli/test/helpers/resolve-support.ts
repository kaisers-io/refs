import { run } from '../../src/main.ts';
import { testContext } from './context.ts';

// The one-call `refs resolve … --json` runner shared by the resolve suites. Extracted from
// `resolve-flags.test.ts` when its `--ref` cases moved into their own file — two copies of the
// envelope shape would have been two places for a new field to be missed.

type ResolveEnvelope = {
  data: Record<string, unknown>;
  error?: { code: string; message: string; reason?: string };
  ok: boolean;
};

const soleEnvelope = (stdout: readonly string[]): ResolveEnvelope => {
  const [line] = stdout;
  if (line === undefined) {
    throw new Error('expected exactly one json envelope line, got none');
  }
  return JSON.parse(line) as ResolveEnvelope;
};

/** Runs `refs resolve <args…> --json` against `homeDir` and returns the parsed envelope. */
const resolveJson = async (homeDir: string, args: readonly string[]): Promise<ResolveEnvelope> => {
  const { ctx, stdout } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  await run(ctx, ['node', 'refs', 'resolve', ...args, '--json']);
  return soleEnvelope(stdout);
};

export { resolveJson, soleEnvelope };
export type { ResolveEnvelope };
