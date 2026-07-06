import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXIT } from '@kaisers-io/refs-core';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const STUB_SOURCE = join(import.meta.dirname, '../bin/refs.mjs');

const FAKE_BUNDLE = `
export function realContext() { return {}; }
export async function run(_ctx, argv) {
  console.log('FAKE_BUNDLE_RAN ' + argv.slice(2).join(' '));
}
`;

// A src/main.ts that Node's type stripping can parse fine, but whose package import can never
// resolve — mimics a fresh clone where `pnpm install` has not run yet (workspace deps missing
// from node_modules).
const UNRESOLVABLE_SRC_MAIN = `
import '@does-not-exist/nowhere';
export const run = () => {};
`;

const SRC_CONTEXT = `
export const realContext = () => ({});
`;

const writeUnresolvableSrc = (home: string): void => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(join(home, 'src'));
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(join(home, 'src/main.ts'), UNRESOLVABLE_SRC_MAIN);
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(join(home, 'src/context.ts'), SRC_CONTEXT);
};

// Builds a temp directory mimicking the package layout (`bin/refs.mjs` + optional `dist/refs.mjs`
// and/or `src/`) so the test is independent of whether this checkout is built. The default layout
// never contains a `src/` tree, so the missing-bundle case also exercises the "no source fallback
// available" path (the fresh-clone src-fallback behavior is verified manually, not simulated here;
// the wrong-Node engine-guard path is also verified manually: running the stub under Node 22 prints
// the `>=24.12 <25` engine message and exits 1).
const layout = (
  withBundle: boolean,
  withUnresolvableSrc = false,
): { binPath: string; home: string } => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  const home = mkdtempSync(join(tmpdir(), 'refs-stub-'));
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(join(home, 'bin'));
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  cpSync(STUB_SOURCE, join(home, 'bin/refs.mjs'));
  if (withBundle) {
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(home, 'dist'));
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(home, 'dist/refs.mjs'), FAKE_BUNDLE);
  }
  if (withUnresolvableSrc) {
    writeUnresolvableSrc(home);
  }
  return { binPath: join(home, 'bin/refs.mjs'), home };
};

describe('bin stub', () => {
  it('fails loudly when neither the bundle nor the source tree is present', () => {
    expect.hasAssertions();
    const { binPath, home } = layout(false);
    try {
      // eslint-disable-next-line node/no-sync -- spawning the subprocess synchronously is the point of this test
      const result = spawnSync(process.execPath, [binPath, '--version'], { encoding: 'utf8' });
      expect(result.status).toBe(EXIT.UNEXPECTED);
      expect(result.stderr).toContain('not built');
      expect(result.stderr).toContain('pnpm install && pnpm build');
    } finally {
      // eslint-disable-next-line node/no-sync -- test cleanup, sync is fine
      rmSync(home, { force: true, recursive: true });
    }
  });

  it('gives actionable guidance when the source fallback cannot resolve its imports', () => {
    expect.hasAssertions();
    const { binPath, home } = layout(false, true);
    try {
      // eslint-disable-next-line node/no-sync -- spawning the subprocess synchronously is the point of this test
      const result = spawnSync(process.execPath, [binPath, '--version'], { encoding: 'utf8' });
      expect(result.status).toBe(EXIT.UNEXPECTED);
      expect(result.stderr).toContain('refs could not run from source');
      expect(result.stderr).toContain('ERR_MODULE_NOT_FOUND');
      expect(result.stderr).toContain('pnpm install && pnpm build');
      expect(result.stderr).not.toContain('at async');
    } finally {
      // eslint-disable-next-line node/no-sync -- test cleanup, sync is fine
      rmSync(home, { force: true, recursive: true });
    }
  });

  it('runs the bundle when present', () => {
    expect.hasAssertions();
    const { binPath, home } = layout(true);
    try {
      // eslint-disable-next-line node/no-sync -- spawning the subprocess synchronously is the point of this test
      const result = spawnSync(process.execPath, [binPath, 'doctor', '--json'], {
        encoding: 'utf8',
      });
      expect(result.status).toBe(EXIT.OK);
      expect(result.stdout).toContain('FAKE_BUNDLE_RAN doctor --json');
    } finally {
      // eslint-disable-next-line node/no-sync -- test cleanup, sync is fine
      rmSync(home, { force: true, recursive: true });
    }
  });
});
