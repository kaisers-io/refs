import { applyConfiguredTransport, resolveAddSource } from '../../src/commands/add-source.ts';
import { describe, expect, it } from 'vitest';
import type { CliContext } from '../../src/context.ts';
import { testContext } from '../helpers/context.ts';
import { zSettings } from '@kaisers-io/refs-core';

// Unit suite for the spec §3 transport rule as consumed by `refs add`: only `npm:`-resolved
// sources are rewritten to the configured `git_transport`; an explicitly-typed url is used
// verbatim. Exercised at the `resolveAddSource` → `applyConfiguredTransport` seam — the exact
// pair `runDryRunCore` calls before cloning and before capturing the url into the proposal —
// because a fake registry packument pointing at a `file://` fixture cannot exist (see the
// matching note in `add.test.ts`), so an ssh rewrite can never be integration-cloned. The
// url-form transform matrix itself (ports, file: exemption, key invariance) lives in core's
// `git-url.test.ts`.

const HTTP_STATUS_OK = 200;
const DEMO_REPOSITORY_URL = 'git+https://github.com/example/demo.git';

const contextWithDemoPackument = (): CliContext => {
  const { ctx } = testContext();
  ctx.fetcher = () =>
    Promise.resolve({
      json: () => Promise.resolve({ repository: { url: DEMO_REPOSITORY_URL } }),
      status: HTTP_STATUS_OK,
    });
  return ctx;
};

describe('applyConfiguredTransport at the add seam', () => {
  it('(f) applies git_transport=ssh to an npm-resolved clone url, key unchanged', async () => {
    expect.hasAssertions();
    const ctx = contextWithDemoPackument();

    const resolved = await resolveAddSource(ctx, 'npm:demo');
    const transported = applyConfiguredTransport(
      resolved,
      zSettings.parse({ git_transport: 'ssh' }),
    );

    expect(transported).toStrictEqual({
      cloneUrl: 'git@github.com:example/demo.git',
      key: 'github.com/example/demo',
      npmPkgName: 'demo',
    });
  });

  it('(g) leaves an npm-resolved https url unchanged under the https default', async () => {
    expect.hasAssertions();
    const ctx = contextWithDemoPackument();

    const resolved = await resolveAddSource(ctx, 'npm:demo');
    const transported = applyConfiguredTransport(resolved, zSettings.parse({}));

    expect(transported).toStrictEqual(resolved);
  });

  it('(h) never transforms an explicitly-typed url, whatever git_transport says', async () => {
    expect.hasAssertions();
    const { ctx } = testContext();

    const resolved = await resolveAddSource(ctx, 'https://github.com/example/demo.git');
    const transported = applyConfiguredTransport(
      resolved,
      zSettings.parse({ git_transport: 'ssh' }),
    );

    expect(transported).toStrictEqual(resolved);
    expect(transported.cloneUrl).toBe('https://github.com/example/demo.git');
  });
});
