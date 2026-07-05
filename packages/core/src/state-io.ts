import { isEnoent, writeFileAtomic } from './fs-atomic.ts';
import type { RefsHome } from './home.ts';
import { readFile } from 'node:fs/promises';
import { validationError } from './errors.ts';
import { z } from 'zod';
import { zState } from './schemas/state.ts';

// Derived from `zState` rather than imported as `State` alongside the `zState` value import —
// Importing both the value and the type from the same module triggers a real conflict between
// This repo's `no-duplicate-imports` and `consistent-type-specifier-style` lint rules (one wants
// A single merged statement, the other wants the type specifier split into its own top-level
// `import type`, and splitting re-triggers `no-duplicate-imports`). Deriving locally sidesteps it
// While staying byte-for-byte the same type as `schemas/state.ts`'s exported `State`.
type State = z.infer<typeof zState>;

const JSON_INDENT = 2;

// Returns the state file's raw text, or `undefined` if it is absent (any other read failure
// Still propagates as a real error, per the module-level self-healing note below).
//
// This propagation is the intended boundary, not an oversight: self-healing (below) exists to
// Recover from a corrupt state file (bad JSON, invalid schema), which is expected to happen since
// State is machine-written and can be interrupted or hand-edited. It does not extend to
// Environment faults such as EACCES or EISDIR — those mean something is wrong with the host
// (permissions, a directory where a file should be, a full disk), and silently falling back to
// Empty state would hide that problem from the user instead of surfacing it.
const readStateTextOrAbsent = async (home: RefsHome): Promise<string | undefined> => {
  try {
    return await readFile(home.statePath, 'utf8');
  } catch (error) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }
};

// `undefined` is a safe "parse failed" sentinel: `JSON.parse` of any valid JSON document never
// Produces `undefined` (it isn't a representable JSON value), so it can't be confused with a
// Genuinely-parsed value.
const tryParseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

// Self-healing (spec §3): a missing file, unparsable JSON, or a schema-invalid document (e.g. a
// Dangerous "__proto__" ref key, or a field that fails validation) all fall back to the empty
// State rather than throwing — state is machine-managed/derived, never hand-authored, so there is
// Nothing a user could "fix" in response to a thrown error. Only unexpected fs errors (e.g.
// Permission denied) propagate, since those indicate a real operational fault.
const readState = async (home: RefsHome): Promise<State> => {
  const text = await readStateTextOrAbsent(home);
  if (text === undefined) {
    return zState.parse({});
  }

  const raw = tryParseJson(text);
  if (raw === undefined) {
    return zState.parse({});
  }

  const result = zState.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  return zState.parse({});
};

const writeState = async (home: RefsHome, state: State): Promise<void> => {
  const result = zState.safeParse(state);
  if (!result.success) {
    throw validationError(z.prettifyError(result.error));
  }
  await writeFileAtomic(home.statePath, `${JSON.stringify(result.data, undefined, JSON_INDENT)}\n`);
};

export { readState, writeState };
