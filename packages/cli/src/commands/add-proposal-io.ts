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

// Repo-wide idiom for "is this a JSON object, not an array/null" (mirrors core's own
// `isPlainObject` in `config-io.ts`/`workspaces-parse.ts` — not exported from core, so
// re-declared locally rather than reaching into an internal module).
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const FAILED_ENVELOPE_MESSAGE =
  'proposal file contains a failed refs envelope (ok is false) — re-run the dry-run';
const NO_USABLE_DATA_MESSAGE =
  'proposal file is a refs envelope without a usable data object — re-run the dry-run';

/** `refs ... --json` always emits a top-level `ok` field (see `output.ts`'s `SuccessEnvelope`/
 * `ErrorEnvelope`), which a bare `FinalProposal` never has — but `ok` alone over-triggers: a
 * hand-edited proposal can pick up a stray top-level `ok` key (e.g. a copy-paste mistake) without
 * being an envelope at all. `key` is the disambiguator: `zFinalProposal` requires it (see
 * `schemas/proposal.ts`'s `zProposalBase`) so every real proposal has one, and no `refs --json`
 * envelope (`{ok, data, warnings}` / `{ok, error}`) ever puts `key` at its top level — that only
 * ever appears nested inside `data`. So "has `ok`, lacks `key`" is the sound envelope signal;
 * anything else (including a bare proposal with a stray `ok`) is left for the strict `zFinalProposal`
 * schema to reject on its own terms. */
const looksLikeEnvelope = (value: unknown): value is Record<string, unknown> =>
  isPlainObject(value) && 'ok' in value && !('key' in value);

/** Unwraps a `refs --json` envelope down to its `data` payload so the exact stdout of
 * `refs add --dry-run --json` can be piped straight into `--proposal` (see docs/commands.md's
 * pipe example) without hand-stripping the envelope first. A failed envelope (`ok: false`) — the
 * dry-run itself errored, so there is no proposal to unwrap — throws a clear message instead of
 * letting the bare `{error, ok}` shape fall through to a confusing zod field-by-field dump.
 * Once something is envelope-shaped and didn't fail, its `data` MUST be a usable object — a
 * missing or non-object `data` (`{"ok":true,"warnings":[]}`, `{"ok":true,"data":"nope"}`) also
 * throws a clear message rather than handing `parseFinalProposal` a value the user never wrote
 * (e.g. validating the literal string `"nope"` and producing a six-field zod dump about it).
 * Anything NOT envelope-shaped (a bare `FinalProposal`, including one with a stray `ok` key)
 * passes through unchanged for `parseFinalProposal` to validate — and reject, via the strict
 * schema, on its own terms. */
const unwrapEnvelope = (value: unknown): unknown => {
  if (!looksLikeEnvelope(value)) {
    return value;
  }
  if (value['ok'] === false) {
    throw validationError(FAILED_ENVELOPE_MESSAGE);
  }
  if (isPlainObject(value['data'])) {
    return value['data'];
  }
  throw validationError(NO_USABLE_DATA_MESSAGE);
};

const NO_ITEMS = 0;
const TOP_LEVEL_PATH = '';

type ZodIssue = z.core.$ZodIssue;
type UnrecognizedKeysIssue = Extract<ZodIssue, { code: 'unrecognized_keys' }>;

const isUnrecognizedKeysIssue = (issue: ZodIssue): issue is UnrecognizedKeysIssue =>
  issue.code === 'unrecognized_keys';

const hasEmptyPath = (issue: ZodIssue): boolean => issue.path.length === NO_ITEMS;

/** One named line per offending location — the repo's established "list ALL offending keys"
 * precedent (see `resolve.ts`'s multi-ref ambiguity message). A top-level issue (empty dot-path)
 * keeps the original wording; a nested one (e.g. a stray key inside a package entry) names its
 * location too: `unrecognized key(s) in proposal at packages.ms: "bogus"`. */
const unrecognizedKeysLine = (dotPath: string, keys: readonly string[]): string => {
  const named = keys
    .toSorted()
    .map((key) => `"${key}"`)
    .join(', ');
  if (dotPath === TOP_LEVEL_PATH) {
    return `✖ unrecognized key(s) in proposal: ${named}`;
  }
  return `✖ unrecognized key(s) in proposal at ${dotPath}: ${named}`;
};

/** Groups `unrecognized_keys` issues by their dot-path (`z.core.toDotPath`, the same renderer
 * `z.prettifyError` uses for its own `→ at <path>` lines) so each location gets one line naming
 * every stray key found there, sorted by path for deterministic output (the top-level `''` path
 * sorts first). */
const unrecognizedKeysLines = (issues: readonly UnrecognizedKeysIssue[]): string[] => {
  const keysByPath = new Map<string, string[]>();
  for (const issue of issues) {
    const dotPath = z.core.toDotPath(issue.path);
    keysByPath.set(dotPath, [...(keysByPath.get(dotPath) ?? []), ...issue.keys]);
  }
  return [...keysByPath.entries()]
    .toSorted(([pathA], [pathB]) => pathA.localeCompare(pathB))
    .map(([dotPath, keys]) => unrecognizedKeysLine(dotPath, keys));
};

/** A non-`unrecognized_keys` issue with an empty path (e.g. the proposal document itself isn't a
 * JSON object at all) has no field name for a `→ at <path>` line to point to, so it would
 * otherwise render as a bare, contextless `Invalid input`. Framing it as being about the proposal
 * as a whole is the best available fallback with no field left to name. */
const emptyPathLine = (issue: ZodIssue): string => `✖ invalid proposal: ${issue.message}`;

/** Renders every `unrecognized_keys` issue (at ANY path) and every other EMPTY-path issue into
 * clear, key-naming lines of our own, and hands every remaining NAMED-path issue to
 * `z.prettifyError` unchanged — it already renders those well (missing/wrong-typed fields get a
 * `→ at <path>` line, e.g. `packages.ms.description`). Falls straight through to a plain
 * `z.prettifyError(error)` when there is nothing to improve, so pinned messages for those cases
 * never change.
 *
 * These issues need their own handling rather than just trusting `z.prettifyError`'s default
 * rendering: in the CLI's own shipped bundle, `zod`'s `package.json` claims `"sideEffects": false`,
 * which is not true of its module-scope `config(en())` locale registration — tsdown/rolldown takes
 * the claim at face value and tree-shakes that registration away, so every un-customized zod issue
 * in the SHIPPED binary (not in this unbundled test suite) renders as a bare `Invalid input`: no
 * offending key at any nesting level, and no path at all for top-level issues. Reading `.keys`
 * directly off `unrecognized_keys` issues (populated on the issue object regardless of locale
 * registration) sidesteps that bundler quirk entirely — exactly the failure mode a hand-edited
 * proposal file (a stray key, top-level or inside a package entry) hits most often. */
const formatProposalError = (error: z.core.$ZodError<FinalProposal>): string => {
  const unrecognized = error.issues.filter((issue): issue is UnrecognizedKeysIssue =>
    isUnrecognizedKeysIssue(issue),
  );
  const rest = error.issues.filter((issue) => !isUnrecognizedKeysIssue(issue));
  const restEmptyPath = rest.filter((issue) => hasEmptyPath(issue));
  if (unrecognized.length === NO_ITEMS && restEmptyPath.length === NO_ITEMS) {
    return z.prettifyError(error);
  }
  const restPathed = rest.filter((issue) => !hasEmptyPath(issue));
  const lines = [
    ...unrecognizedKeysLines(unrecognized),
    ...restEmptyPath.map((issue) => emptyPathLine(issue)),
  ];
  if (restPathed.length > NO_ITEMS) {
    lines.push(z.prettifyError({ issues: restPathed }));
  }
  return lines.join('\n');
};

/** Validates the parsed JSON against `zFinalProposal`, rendering a legible error on failure — the
 * two-phase contract's whole point is that a human (or agent) may have hand-edited this file, so
 * validation failures need to name what's wrong, not print a raw zod issue dump (see
 * `formatProposalError`). */
const parseFinalProposal = (raw: unknown): FinalProposal => {
  const parsed = zFinalProposal.safeParse(raw);
  if (!parsed.success) {
    throw validationError(formatProposalError(parsed.error));
  }
  return parsed.data;
};

/** Reads `location` (a file path, or `-` for stdin) and parses+validates it as a `FinalProposal` —
 * accepting either a bare proposal object or the full `refs ... --dry-run --json` envelope
 * wrapping one (see `unwrapEnvelope`). */
const loadFinalProposal = async (ctx: CliContext, location: string): Promise<FinalProposal> => {
  const text = await readProposalText(ctx, location);
  return parseFinalProposal(unwrapEnvelope(parseProposalJson(text)));
};

export { loadFinalProposal };
