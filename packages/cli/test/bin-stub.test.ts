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

// Builds a temp directory mimicking the package layout (`bin/refs.mjs` + optional `dist/refs.mjs`)
// so the test is independent of whether this checkout is built. The layout never contains a
// `src/` tree, so the missing-bundle case also exercises the "no source fallback available"
// path (the fresh-clone src-fallback behavior is verified manually, not simulated here).
const layout = (withBundle: boolean): { binPath: string; home: string } => {
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
