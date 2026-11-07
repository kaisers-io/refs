import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { parse } from 'yaml';
import { readFile } from 'node:fs/promises';

// Guards the supply-chain setting in the root pnpm-workspace.yaml against accidental removal.
// It does not re-implement pnpm; it pins the settings that would quietly switch the check off.
// A reviewed exception stays possible: trustPolicyExclude may list exact `name@version` entries.
// pnpm reads an entry without a version (a bare name or a name glob) as "every version", which
// is a blanket waiver, so only entries pinned to exact versions pass.
// https://pnpm.io/settings/dependency-resolution#trustpolicy

const NAME = String.raw`(?:@[a-z0-9~-][a-z0-9._~-]*/)?[a-z0-9~-][a-z0-9._~-]*`;
const VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`;
const PINNED = new RegExp(String.raw`^${NAME}@${VERSION}(?:\s*\|\|\s*${VERSION})*$`, 'u');

const isPinnedExclusion = (entry: unknown): boolean =>
  typeof entry === 'string' && PINNED.test(entry);

const workspaceSettings = async (): Promise<Record<string, unknown>> => {
  const path = join(import.meta.dirname, '../../../pnpm-workspace.yaml');
  return parse(await readFile(path, 'utf8')) as Record<string, unknown>;
};

// Every trustPolicyExclude entry that is not pinned; a non-list value is returned whole.
const unpinnedExclusions = (settings: Record<string, unknown>): unknown[] => {
  const exclude = settings['trustPolicyExclude'] ?? [];
  return Array.isArray(exclude) ? exclude.filter((entry) => !isPinnedExclusion(entry)) : [exclude];
};

describe('pnpm trust policy in pnpm-workspace.yaml', () => {
  it('refuses trust downgrades and re-checks the lockfile', async () => {
    expect.hasAssertions();
    const settings = await workspaceSettings();
    expect(settings['trustPolicy']).toBe('no-downgrade');
    expect(settings['trustLockfile']).not.toBe(true);
    expect(settings['trustPolicyIgnoreAfter']).toBeUndefined();
  });

  it('allows only exceptions pinned to exact versions', async () => {
    expect.hasAssertions();
    const settings = await workspaceSettings();
    expect(unpinnedExclusions(settings)).toStrictEqual([]);
  });

  it('tells a pinned exception from a blanket waiver', () => {
    expect.hasAssertions();
    const pinned = ['chokidar@4.0.3', '@babel/core@7.28.5', 'webpack@4.47.0 || 5.102.1'];
    const blanket = ['chokidar', '@babel/*', '*', 'chokidar@^4.0.0', 'chokidar@4', 'a@1.0.0 || ^2'];
    expect(unpinnedExclusions({ trustPolicyExclude: pinned })).toStrictEqual([]);
    expect(unpinnedExclusions({ trustPolicyExclude: blanket })).toStrictEqual(blanket);
  });
});
