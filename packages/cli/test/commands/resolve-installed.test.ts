import { assertProjectDir, resolveInstalled } from '../../src/commands/resolve-installed.ts';
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Finding the version a project actually has installed. The alternative was telling the agent to
// parse lockfiles, so the bar here is being RIGHT about what is installed, and honest when it
// cannot tell — never a plausible guess.

const makeProject = (): Promise<string> => mkdtemp(join(tmpdir(), 'refs-installed-'));

const install = async (root: string, name: string, manifest: unknown): Promise<void> => {
  const dir = join(root, 'node_modules', ...name.split('/'));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest));
};

describe('resolving an installed version', () => {
  it('reads the version from the nearest node_modules', async () => {
    expect.hasAssertions();
    const project = await makeProject();
    await install(project, 'zod', { name: 'zod', version: '3.1.0' });

    await expect(resolveInstalled(project, 'zod')).resolves.toMatchObject({
      status: 'found',
      version: '3.1.0',
    });
  });

  it('walks up to an ancestor, the way Node would', async () => {
    expect.hasAssertions();
    const root = await makeProject();
    await install(root, 'zod', { name: 'zod', version: '3.1.0' });
    const nested = join(root, 'apps', 'api');
    await mkdir(nested, { recursive: true });

    await expect(resolveInstalled(nested, 'zod')).resolves.toMatchObject({ version: '3.1.0' });
  });

  it('prefers the nearest installation over a shadowed ancestor one', async () => {
    expect.hasAssertions();
    // A monorepo where one workspace pins a different version. Reporting the root's would answer a
    // question nobody asked — Node would not load it from there.
    const root = await makeProject();
    await install(root, 'zod', { name: 'zod', version: '3.1.0' });
    const nested = join(root, 'apps', 'api');
    await install(nested, 'zod', { name: 'zod', version: '4.9.0' });

    await expect(resolveInstalled(nested, 'zod')).resolves.toMatchObject({ version: '4.9.0' });
  });
});

describe('resolving an installed version of a scoped or aliased package', () => {
  it('handles a scoped name as two path segments', async () => {
    expect.hasAssertions();
    const project = await makeProject();
    await install(project, '@scope/pkg', { name: '@scope/pkg', version: '1.2.3' });

    await expect(resolveInstalled(project, '@scope/pkg')).resolves.toMatchObject({
      version: '1.2.3',
    });
  });

  it('reports the manifest name, so an alias is visible rather than assumed away', async () => {
    expect.hasAssertions();
    const project = await makeProject();
    await install(project, 'my-zod', { name: 'zod', version: '3.1.0' });

    await expect(resolveInstalled(project, 'my-zod')).resolves.toMatchObject({ name: 'zod' });
  });
});

describe('resolving an installed version it cannot determine', () => {
  it('says not_materialized rather than guessing when nothing is installed', async () => {
    expect.hasAssertions();
    const project = await makeProject();

    await expect(resolveInstalled(project, 'zod')).resolves.toStrictEqual({
      status: 'not_materialized',
    });
  });

  it('stops at an installed slot whose manifest is unusable, instead of falling through', async () => {
    expect.hasAssertions();
    // The slot exists, so this IS the installation Node would load. Continuing to an ancestor would
    // report a different version as though it were this one.
    const root = await makeProject();
    await install(root, 'zod', { name: 'zod', version: '3.1.0' });
    const nested = join(root, 'apps', 'api');
    await mkdir(join(nested, 'node_modules', 'zod'), { recursive: true });

    await expect(resolveInstalled(nested, 'zod')).resolves.toMatchObject({
      reason: 'manifest_unreadable',
      status: 'unverifiable',
    });
  });
});

describe('resolving an installed version from an unusable manifest', () => {
  it('reports a manifest with no version as unverifiable, not as absent', async () => {
    expect.hasAssertions();
    const project = await makeProject();
    await install(project, 'zod', { name: 'zod' });

    await expect(resolveInstalled(project, 'zod')).resolves.toMatchObject({
      reason: 'manifest_has_no_version',
      status: 'unverifiable',
    });
  });

  it('detects Yarn PnP without loading it', async () => {
    expect.hasAssertions();
    // `.pnp.cjs` is project code. Reading a version out of it would mean executing it, so its
    // presence is only ever detected — and only after the node_modules walk finds nothing, since a
    // project mid-migration can carry both.
    const project = await makeProject();
    await writeFile(join(project, '.pnp.cjs'), 'throw new Error("must never be executed");');

    await expect(resolveInstalled(project, 'zod')).resolves.toStrictEqual({
      reason: 'yarn_pnp',
      status: 'unsupported_layout',
    });
  });
});

describe('resolving an installed version for an unusable name', () => {
  it('refuses a package name that could climb out of node_modules', async () => {
    expect.hasAssertions();
    // Package names come from `config.toml`, whose keys are checked for being non-empty and
    // non-dangerous — not for being valid npm names.
    const project = await makeProject();

    await expect(resolveInstalled(project, '../../etc')).resolves.toMatchObject({
      reason: 'unsupported_package_name',
      status: 'unverifiable',
    });
  });
});

describe('validating the project directory', () => {
  it('rejects a path that does not exist', async () => {
    expect.hasAssertions();

    const absent = join(tmpdir(), 'refs-no-such-project');

    await expect(assertProjectDir(absent)).rejects.toThrow('does not exist');
  });

  it('rejects a file', async () => {
    expect.hasAssertions();
    const project = await makeProject();
    const file = join(project, 'a-file');
    await writeFile(file, '');

    await expect(assertProjectDir(file)).rejects.toThrow('must be a directory');
  });
});
