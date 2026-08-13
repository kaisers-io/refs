import type { FakeRunner, RefsHome } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { checkoutPath, readConfig, readState, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { seedConfig, seedState } from '../helpers/ref-fixtures.ts';
import type { CliContext } from '../../src/context.ts';
import type { FinalizeOpts } from '../../src/commands/add-finalize.ts';
import type { FinalizedRefInput } from '../../src/commands/add-packages.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { finalizeRef } from '../../src/commands/add-finalize.ts';
import { testContext } from '../helpers/context.ts';
import { withTempHome } from '../helpers/add-support.ts';

// Direct `finalizeRef` coverage for the write-path contracts the add e2e suite doesn't reach:
// a schema-invalid final document must leave the home directory completely untouched (validated
// BEFORE either write — see `buildValidatedFinalDocs`), and the `--proposal` flow's
// `effective_clone_mode` fallback chain (prior dry-run state → resolved global setting) must pick
// the right source when no clone ran in this process. The checkout-head resolution is scripted via
// `FakeRunner` — its guards have their own suites; what's under test here is only the finalize
// write path behind them.

const REF_KEY = zRefKey.parse('example.com/acme/widget');
const REF_URL = 'https://example.com/acme/widget.git';
const SHA_LENGTH = 40;
const VALID_SHA = 'f'.repeat(SHA_LENGTH);

// `resolveCheckoutHead`'s command sequence: origin identity, managed marker, then the head sha.
const scriptHeadResolution = (runner: FakeRunner, hooksDir: string): void => {
  runner.expect('git remote get-url origin', { stdout: `${REF_URL}\n` });
  runner.expect('git config --local core.hooksPath', { stdout: `${hooksDir}\n` });
  runner.expect('git rev-parse HEAD', { stdout: `${VALID_SHA}\n` });
};

type FinalizeFixture = {
  ctx: CliContext;
  home: RefsHome;
  opts: (ref: FinalizedRefInput) => FinalizeOpts;
};

const setupFinalizeHome = async (homeDir: string): Promise<FinalizeFixture> => {
  const { ctx, runner } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  const home = resolveHome(ctx.env);
  await seedConfig(home, {});
  scriptHeadResolution(runner, home.hooksDir);
  const dest = checkoutPath(home, REF_KEY);
  return { ctx, home, opts: (ref) => ({ dest, home, ref }) };
};

const refInput = (description: string): FinalizedRefInput => ({
  default_branch: 'main',
  description,
  key: REF_KEY,
  tag_format: 'v{version}',
  url: REF_URL,
});

// The same input minus the format — what `add.ts` builds when the dry-run's
// `tag_format_candidate` came back `null` and nobody supplied one.
const untaggedRefInput = (description: string): FinalizedRefInput => ({
  default_branch: 'main',
  description,
  key: REF_KEY,
  url: REF_URL,
});

describe('finalize: schema-invalid documents leave the home untouched', () => {
  it('rejects an invalid ref entry before writing either config or state', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const { ctx, home, opts } = await setupFinalizeHome(homeDir);
      // An empty description violates `zRefEntry.description`'s min(1) — the full-document
      // validation must catch it and abort before the state-then-config write sequence starts.
      const invalidOpts = opts(refInput(''));
      await expect(finalizeRef(ctx, invalidOpts)).rejects.toThrow(/description/u);
      const config = await readConfig(home);
      expect(config.refs[REF_KEY]).toBeUndefined();
      const state = await readState(home);
      expect(state.refs[REF_KEY]).toBeUndefined();
    });
  });
});

describe('finalize: a ref with no tag_format', () => {
  it('writes the entry with the field absent rather than rejecting it', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const { ctx, home, opts } = await setupFinalizeHome(homeDir);

      const result = await finalizeRef(ctx, opts(untaggedRefInput('A repo that never tags.')));

      expect(result.key).toBe(REF_KEY);
      const config = await readConfig(home);
      const entry = config.refs[REF_KEY];
      expect(entry).toBeDefined();
      expect(entry).not.toHaveProperty('tag_format');
      // Everything else is written exactly as it would be with a format present — this is a
      // complete entry, not a degraded one.
      expect(entry?.description).toBe('A repo that never tags.');
      expect(entry?.url).toBe(REF_URL);
    });
  });
});

describe('finalize: effective_clone_mode fallback chain', () => {
  it('falls back to the resolved global setting when neither opts nor state know a mode', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const { ctx, home, opts } = await setupFinalizeHome(homeDir);
      const result = await finalizeRef(ctx, opts(refInput('A fixture ref.')));
      expect(result.key).toBe(REF_KEY);
      const state = await readState(home);
      // The seeded config carries default settings, whose clone_mode is 'blobless'.
      expect(state.refs[REF_KEY]).toStrictEqual({
        effective_clone_mode: 'blobless',
        head_sha: VALID_SHA,
        last_fetched_at: state.refs[REF_KEY]?.last_fetched_at,
      });
    });
  });

  it('prefers the mode a prior dry-run persisted in state over the global setting', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const { ctx, home, opts } = await setupFinalizeHome(homeDir);
      await seedState(home, { [REF_KEY]: { effective_clone_mode: 'full' } });
      await finalizeRef(ctx, opts(refInput('A fixture ref.')));
      const state = await readState(home);
      expect(state.refs[REF_KEY]?.effective_clone_mode).toBe('full');
    });
  });
});
