import { addPackage, freshRepo, writeJson } from './helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import { detectWorkspacePackagesDetailed, scanIsReliable } from '../src/workspaces.ts';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The search behind a link the walk cannot follow: is there a manifest down there at all?
//
// It answers the only question the `candidate_not_inspected` diagnostic exists to raise. Where the
// answer is no, nothing any pattern could select was hidden — and where anything at all stands in
// the way of answering, the diagnostic stands.

describe('a symlink with no package behind it', () => {
  it('says nothing, because the look found nothing to say', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/**/*'] });
    addPackage(repo, 'packages/real', { name: '@deep/real', version: '1.0.0' });
    // astro's shape: the link points at fixture content — markdown and json, no manifest at any
    // depth. Nothing any pattern could select is behind it, so not walking it hid nothing.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(repo, 'content', 'nested'), { recursive: true });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(repo, 'content', 'nested', 'first.md'), '# hi');
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(join(repo, 'content'), join(repo, 'packages', 'linked'), 'dir');

    const scan = await detectWorkspacePackagesDetailed(repo);

    expect(scan.diagnostics).toStrictEqual([]);
    expect(scanIsReliable(scan)).toBe(true);
  });

  it('reports one whose target holds a manifest further down', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/**/*'] });
    addPackage(repo, 'packages/real', { name: '@deep/real', version: '1.0.0' });
    addPackage(repo, 'elsewhere/deep/down/pkg', { name: '@deep/hidden', version: '1.0.0' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(join(repo, 'elsewhere'), join(repo, 'packages', 'linked'), 'dir');

    const scan = await detectWorkspacePackagesDetailed(repo);

    // Three levels down is still behind the link. Checking only the target's own directory would
    // answer a different question from the one being asked.
    expect(scan.diagnostics).toStrictEqual([
      { kind: 'candidate_not_inspected', path: 'packages/linked' },
    ]);
  });
});

/** A checkout whose `packages/linked` points at a directory whose `package.json` is itself a
 * link into the repository — a shape the manifest probe accepts. */
const withLinkedManifest = (): string => {
  const repo = freshRepo();
  writeJson(join(repo, 'package.json'), { workspaces: ['packages/**/*'] });
  addPackage(repo, 'packages/real', { name: '@deep/real', version: '1.0.0' });
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(join(repo, 'manifests'), { recursive: true });
  writeJson(join(repo, 'manifests', 'pkg.json'), { name: '@deep/linked', version: '1.0.0' });
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(join(repo, 'content'), { recursive: true });
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  symlinkSync(join(repo, 'manifests', 'pkg.json'), join(repo, 'content', 'package.json'));
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  symlinkSync(join(repo, 'content'), join(repo, 'packages', 'linked'), 'dir');
  return repo;
};

describe('what the search behind a link will not rule out', () => {
  it('counts a symlinked manifest as a manifest', async () => {
    expect.hasAssertions();
    const repo = withLinkedManifest();

    const scan = await detectWorkspacePackagesDetailed(repo);

    // `isFile()` is false for a symlinked `package.json`, and the manifest probe accepts that
    // shape — so testing for a regular file would answer "no manifest" about a real package.
    expect(scan.diagnostics).toStrictEqual([
      { kind: 'candidate_not_inspected', path: 'packages/linked' },
    ]);
  });

  it('stops at a link inside the subtree it is searching', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/**/*'] });
    addPackage(repo, 'packages/real', { name: '@deep/real', version: '1.0.0' });
    addPackage(repo, 'far/away/pkg', { name: '@deep/far', version: '1.0.0' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(repo, 'content'), { recursive: true });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(join(repo, 'far'), join(repo, 'content', 'onward'), 'dir');
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(join(repo, 'content'), join(repo, 'packages', 'linked'), 'dir');

    const scan = await detectWorkspacePackagesDetailed(repo);

    // Ruling out what is behind a second link would mean following links from inside a link, and
    // the cheap search would need cycle bookkeeping of its own. It stops and says so instead.
    expect(scan.diagnostics).toStrictEqual([
      { kind: 'candidate_not_inspected', path: 'packages/linked' },
    ]);
  });
});

describe('manifest names the filesystem may fold', () => {
  it('does not rule out a target holding a differently-cased manifest', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/**/*'] });
    addPackage(repo, 'packages/real', { name: '@deep/real', version: '1.0.0' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(repo, 'content'), { recursive: true });
    writeJson(join(repo, 'content', 'Package.json'), { name: '@deep/cased', version: '1.0.0' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(join(repo, 'content'), join(repo, 'packages', 'linked'), 'dir');

    const scan = await detectWorkspacePackagesDetailed(repo);

    // On a case-insensitive filesystem the manifest probe opens that file by its lowercase name
    // and reads a real package. On a case-sensitive one this is a file that is not a manifest and
    // the link stays marked uninspected — over-reporting, which is the direction to err in.
    expect(scan.diagnostics).toStrictEqual([
      { kind: 'candidate_not_inspected', path: 'packages/linked' },
    ]);
  });
});
