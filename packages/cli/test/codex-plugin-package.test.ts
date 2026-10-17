import { describe, expect, it } from 'vitest';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { parse } from 'yaml';

// The Codex plugin package: `.agents/plugins/marketplace.json` at the repository root lists one
// plugin whose root is `skills/`, and `skills/.codex-plugin/plugin.json` names `./refs` as its skill
// root. Codex copies the plugin root into its cache on `codex plugin add`, so what sits in `skills/`
// is exactly what a user installs. Rules here are the ones Codex 0.163 enforces or was observed to
// follow (see docs/install.md): manifest paths start with `./` and stay inside the plugin root,
// the version names the cache directory and drives updates, and symlinks are not copied.

const REPO = resolve(import.meta.dirname, '../../..');
const MARKETPLACE = join(REPO, '.agents', 'plugins', 'marketplace.json');

type Json = Record<string, unknown>;

const readJson = async (path: string): Promise<Json> =>
  JSON.parse(await readFile(path, 'utf8')) as Json;

const frontmatterOf = async (path: string): Promise<Json> => {
  const source = await readFile(path, 'utf8');
  const body = /^---\r?\n(?<body>[\s\S]*?)\r?\n---/u.exec(source)?.groups?.['body'] ?? '';
  return parse(body) as Json;
};

/** Resolves a manifest path the way Codex does: `./`-prefixed, no `..`, inside `root`. */
const insideRoot = (root: string, path: unknown): string => {
  expect(path).toBeTypeOf('string');
  const text = String(path);
  expect(text.startsWith('./')).toBe(true);
  expect(text.split('/')).not.toContain('..');
  const resolved = resolve(root, text);
  const rel = relative(root, resolved);
  expect(rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)).toBe(true);
  return resolved;
};

const pluginRoot = async (): Promise<string> => {
  const marketplace = await readJson(MARKETPLACE);
  const [entry] = marketplace['plugins'] as Json[];
  const source = entry?.['source'] as Json;
  return insideRoot(REPO, source['path']);
};

const pluginManifest = async (): Promise<Json> =>
  readJson(join(await pluginRoot(), '.codex-plugin', 'plugin.json'));

/** Every entry under `dir`, as paths relative to it. */
const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { recursive: true });
  return entries.map(String).toSorted();
};

describe('codex plugin: marketplace', () => {
  it('lists exactly one plugin, refs, from a local path in this repository', async () => {
    expect.hasAssertions();
    const marketplace = await readJson(MARKETPLACE);
    expect(marketplace['name']).toBe('kaisers-io');
    const plugins = marketplace['plugins'] as Json[];
    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({
      name: 'refs',
      policy: { installation: 'AVAILABLE' },
      source: { path: './skills', source: 'local' },
    });
  });
});

describe('codex plugin: manifest', () => {
  it('names the plugin refs and points its skill root at the existing skill', async () => {
    expect.hasAssertions();
    const root = await pluginRoot();
    const manifest = await pluginManifest();
    expect(manifest['name']).toBe('refs');
    const skillDir = insideRoot(root, manifest['skills']);
    expect(skillDir).toBe(join(REPO, 'skills', 'refs'));
    const frontmatter = await frontmatterOf(join(skillDir, 'SKILL.md'));
    expect(frontmatter['name']).toBe('refs');
  });

  it('carries the CLI version, which names the cache directory and drives updates', async () => {
    expect.hasAssertions();
    const cli = await readJson(join(REPO, 'packages', 'cli', 'package.json'));
    const skill = await frontmatterOf(join(REPO, 'skills', 'refs', 'SKILL.md'));
    const manifest = await pluginManifest();
    expect(manifest['version']).toBe(cli['version']);
    expect((skill['metadata'] as Json)['cli_version']).toBe(cli['version']);
  });

  it('resolves every interface asset inside the plugin root', async () => {
    expect.hasAssertions();
    const root = await pluginRoot();
    const manifest = await pluginManifest();
    const ui = manifest['interface'] as Json;
    for (const key of ['composerIcon', 'logo']) {
      // eslint-disable-next-line no-await-in-loop -- two files, order irrelevant, clearer serial
      const info = await lstat(insideRoot(root, ui[key]));
      expect(info.isFile()).toBe(true);
    }
  });
});

describe('codex plugin: installed contents', () => {
  // `codex plugin add` copies the plugin root wholesale. Anything new in `skills/` ships to every
  // plugin user, so the list is pinned rather than globbed.
  it('holds only the manifest and the skill', async () => {
    expect.hasAssertions();
    const root = await pluginRoot();
    const top = await readdir(root);
    expect(top.toSorted()).toStrictEqual(['.codex-plugin', 'refs']);
    await expect(readdir(join(root, '.codex-plugin'))).resolves.toStrictEqual(['plugin.json']);
  });

  // Codex drops symlinks when it copies a plugin into its cache: a linked skill installs as an
  // empty directory and loads nothing.
  it('contains no symlinks', async () => {
    expect.hasAssertions();
    const root = await pluginRoot();
    const entries = await walk(root);
    const infos = await Promise.all(entries.map((entry) => lstat(join(root, entry))));
    const links = entries.filter((_entry, index) => infos[index]?.isSymbolicLink());
    expect(entries).toContain(join('refs', 'SKILL.md'));
    expect(links).toStrictEqual([]);
  });

  // The plugin must not loosen the skill's invocation policy: Codex reads it from the same file.
  it('keeps implicit invocation off', async () => {
    expect.hasAssertions();
    const yaml = await readFile(join(REPO, 'skills', 'refs', 'agents', 'openai.yaml'), 'utf8');
    expect(((parse(yaml) as Json)['policy'] as Json)['allow_implicit_invocation']).toBe(false);
  });
});
