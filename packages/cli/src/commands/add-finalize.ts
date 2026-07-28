import type { CloneMode, Config, RefEntry, RefKey, RefsHome, State } from '@kaisers-io/refs-core';
import { allowFileUrlsFrom, ensureNoConflict, refLockName } from './add-helpers.ts';
import {
  assertInsideSources,
  readConfig,
  readState,
  resolveSetting,
  validationError,
  withLock,
  writeConfig,
  writeState,
  zConfig,
  zState,
} from '@kaisers-io/refs-core';
import type { CliContext } from '../context.ts';
import type { FinalizedRefInput } from './add-packages.ts';
import { buildRefEntry } from './add-packages.ts';
import { resolveCheckoutHead } from './add-checkout-guards.ts';
import { z } from 'zod';

// `finalizeRef` and its supporting document-build/validate helpers — split out of `add.ts` purely
// to keep that file under the repo's 300-line oxlint cap. `add.ts` calls `finalizeRef` from both
// its `--proposal` and `--description` flows; everything it needs to build a `FinalizeOpts` lives
// there, not here.

interface FinalizeOpts {
  dest: string;
  // Known directly only in the `--description` one-shot flow (its dry-run core ran in the same
  // process); `--proposal` never re-clones, so it falls back to whatever a prior `--dry-run`
  // persisted in state, and only as a last resort to the resolved global setting (see
  // `writePendingProposal` in `add-dry-run.ts`).
  effectiveCloneMode?: CloneMode;
  home: RefsHome;
  ref: FinalizedRefInput;
}

interface FinalDocs {
  config: Config;
  entry: RefEntry;
  state: State;
}

// Validates BOTH the new config document and the new state document in full — the exact schemas
// `writeConfig`/`writeState` themselves parse against — before either is ever written. Split out
// of `buildValidatedFinalDocs` purely to keep both functions under the repo's `max-statements` cap.
const parseFinalDocsOrThrow = (config: Config, state: State): { config: Config; state: State } => {
  const configResult = zConfig.safeParse(config);
  if (!configResult.success) {
    throw validationError(z.prettifyError(configResult.error));
  }
  const stateResult = zState.safeParse(state);
  if (!stateResult.success) {
    throw validationError(z.prettifyError(stateResult.error));
  }
  return { config: configResult.data, state: stateResult.data };
};

// Builds BOTH the new config document and the new state document — a schema-invalid document (of
// either kind, checked by `parseFinalDocsOrThrow`) must leave the home directory untouched, not
// landed as far as it got.
const buildValidatedFinalDocs = async (opts: FinalizeOpts, headSha: string): Promise<FinalDocs> => {
  const config = await readConfig(opts.home);
  ensureNoConflict(config, opts.ref.key);
  const entry = buildRefEntry(opts.ref);
  config.refs[opts.ref.key] = entry;
  const state = await readState(opts.home);
  state.refs[opts.ref.key] = {
    effective_clone_mode:
      opts.effectiveCloneMode ??
      state.refs[opts.ref.key]?.effective_clone_mode ??
      resolveSetting('clone_mode', undefined, config.settings),
    head_sha: headSha,
    last_fetched_at: new Date().toISOString(),
  };
  const validated = parseFinalDocsOrThrow(config, state);
  return { ...validated, entry };
};

// Finalizes a ref in two sequential (never nested) lock acquisitions:
//  1. Under the per-ref lock, verify the checkout at `opts.dest` is still the one we expect —
//     FIRST that it still physically lives inside `sources/` (`assertInsideSources`: an ancestor
//     path segment swapped for a symlink between dry-run and finalize would otherwise get a
//     checkout OUTSIDE the managed tree adopted — its origin and marker both still match, so the
//     identity guards below cannot catch that), then that its origin identity matches
//     `opts.ref.url`, that it still carries the refs-managed marker (otherwise it could have been
//     swapped for an unmanaged manual clone of the same origin between dry-run and finalize),
//     that `git rev-parse HEAD` actually succeeds (`Runner.run` never throws on a non-zero exit,
//     so a corrupt/removed checkout would otherwise hand back garbage `stdout` as if it were a
//     real sha), AND that the resulting sha has the exact shape `zState` requires — see
//     `resolveCheckoutHead`. Nothing is written yet, so a bad checkout fails closed: the ref
//     never gets a half-finalized entry.
//  2. Only once a good `head_sha` is in hand does a single home-lock acquisition write config and
//     state — but writing is itself two steps, deliberately ordered:
//       a) `buildValidatedFinalDocs` builds and validates both documents before either is written.
//       b) write state FIRST, config LAST: config is the commit point for a configured ref, so an
//          orphaned state entry for a not-yet-configured ref is harmless by design (state is
//          machine-managed and self-healing — see `state-io.ts`'s `readState`), whereas the reverse
//          (a configured ref with no state entry) would be a real, user-visible inconsistency. This
//          is also what made finalize atomic in practice: previously `writeConfig` landed BEFORE
//          `writeState`'s own validation ran, so e.g. a SHA-256 (`--object-format=sha256`) repo's
//          64-character head sha could persist the config entry and only then fail `writeState`,
//          leaving the ref stuck (retrying hit `ensureNoConflict`).
const finalizeRef = async (
  ctx: CliContext,
  opts: FinalizeOpts,
): Promise<{ entry: RefEntry; key: RefKey }> => {
  const allowFileUrls = allowFileUrlsFrom(ctx.env);
  const headSha = await withLock(opts.home, refLockName(opts.ref.key), () => {
    assertInsideSources(opts.home, opts.dest);
    return resolveCheckoutHead(ctx.runner, {
      allowFileUrls,
      dest: opts.dest,
      expectedUrl: opts.ref.url,
      hooksDir: opts.home.hooksDir,
      key: opts.ref.key,
    });
  });
  return withLock(opts.home, 'home', async () => {
    const { config, entry, state } = await buildValidatedFinalDocs(opts, headSha);
    await writeState(opts.home, state);
    await writeConfig(opts.home, config);
    return { entry, key: opts.ref.key };
  });
};

export { finalizeRef };
export type { FinalizeOpts };
