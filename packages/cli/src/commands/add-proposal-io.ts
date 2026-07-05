import { validationError, zFinalProposal } from '@kaisers-io/refs-core';
import type { CliContext } from '../context.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { FinalProposal } from '@kaisers-io/refs-core';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

// Loads and validates the `--proposal <file|->` JSON payload — split out of `add.ts` purely to
// keep that file under the repo's 300-line oxlint cap.

const STDIN_MARKER = '-';

/** Reads the proposal JSON's raw text: `-` reads stdin (via `ctx.readStdin`), anything else is a
 * file path. Kept separate from parsing so a file-not-found error surfaces with its own
 * `ENOENT`-flavoured message rather than being folded into "invalid JSON". */
const readProposalText = (ctx: CliContext, location: string): Promise<string> => {
  if (location === STDIN_MARKER) {
    return ctx.readStdin();
  }
  return readFile(location, 'utf8');
};

const errorDetail = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const parseProposalJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw validationError(`invalid JSON in proposal: ${errorDetail(error)}`);
  }
};

/** Validates the parsed JSON against `zFinalProposal`, rendering a zod "pretty" error on failure —
 * the two-phase contract's whole point is that a human (or agent) may have hand-edited this file,
 * so validation failures need to be legible, not a raw zod issue dump. */
const parseFinalProposal = (raw: unknown): FinalProposal => {
  const parsed = zFinalProposal.safeParse(raw);
  if (!parsed.success) {
    throw validationError(z.prettifyError(parsed.error));
  }
  return parsed.data;
};

/** Reads `location` (a file path, or `-` for stdin) and parses+validates it as a `FinalProposal`. */
const loadFinalProposal = async (ctx: CliContext, location: string): Promise<FinalProposal> => {
  const text = await readProposalText(ctx, location);
  return parseFinalProposal(parseProposalJson(text));
};

export { loadFinalProposal };
