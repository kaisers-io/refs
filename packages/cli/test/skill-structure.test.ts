import {
  credentialProblems,
  frontmatterProblems,
  headingsOf,
  linkProblems,
  openaiProblems,
  sectionProblems,
} from './helpers/skill-structure.ts';
import { describe, expect, it } from 'vitest';
import { join, relative, resolve } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import type { Json } from './helpers/skill-structure.ts';
import { existsSync } from 'node:fs';
import { parse } from 'yaml';

// The skill's structure: frontmatter an agent reads to decide how to load it, `openai.yaml` keys
// Codex reads, and the links and `§` references its files use to send an agent to each other.
// An edit that renumbers a section, or a typo in `disable-model-invocation` (which makes Claude
// Code load the skill implicitly), would otherwise pass every other check.

const SKILLS = resolve(import.meta.dirname, '../../../skills');
const SKILL = join(SKILLS, 'refs');

// eslint-disable-next-line node/no-sync -- the rules take a synchronous existence check
const existsInSkill = (path: string): boolean => existsSync(join(SKILL, path));

const inFixture = (path: string): boolean => ['A.md', 'sub/B.md'].includes(path);

const frontmatterOf = (source: string): Json =>
  parse(/^---\r?\n(?<body>[\s\S]*?)\r?\n---/u.exec(source)?.groups?.['body'] ?? '') as Json;

/** Every text file under `skills/`, keyed by its path relative to `dir`. */
const textFiles = async (dir: string): Promise<Map<string, string>> => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && !entry.name.endsWith('.png'));
  const pairs = await Promise.all(
    files.map(async (entry): Promise<[string, string]> => {
      const path = join(entry.parentPath, entry.name);
      return [relative(dir, path), await readFile(path, 'utf8')];
    }),
  );
  return new Map(pairs);
};

const markdown = async (): Promise<Map<string, string>> =>
  new Map([...(await textFiles(SKILL))].filter(([file]) => file.endsWith('.md')));

const headingLookup =
  (docs: ReadonlyMap<string, string>) =>
  (target: string): Set<string> | undefined => {
    const text = docs.get(target);
    return text === undefined ? undefined : headingsOf(text);
  };

describe('skills/refs/SKILL.md frontmatter', () => {
  it('uses only known keys, keeps implicit loading off, and has a valid name and description', async () => {
    expect.hasAssertions();
    const source = await readFile(join(SKILL, 'SKILL.md'), 'utf8');
    expect(frontmatterProblems('SKILL.md', 'refs', frontmatterOf(source))).toStrictEqual([]);
  });

  it('would catch an unknown key, a misspelt invocation switch, and a bad name', () => {
    expect.hasAssertions();
    const bad = { description: 'x', 'disable-model-invokation': true, name: 'Refs' };
    expect(frontmatterProblems('SKILL.md', 'refs', bad)).toStrictEqual([
      "SKILL.md: unknown frontmatter key 'disable-model-invokation'",
      'SKILL.md: disable-model-invocation must be true',
      "SKILL.md: name must be a lowercase-hyphenated name of at most 64 characters equal to 'refs'",
    ]);
  });
});

describe('skills/refs/agents/openai.yaml', () => {
  it('uses only the keys Codex documents, and its icons exist', async () => {
    expect.hasAssertions();
    const yaml = parse(await readFile(join(SKILL, 'agents', 'openai.yaml'), 'utf8')) as Json;
    expect(openaiProblems('openai.yaml', yaml, existsInSkill)).toStrictEqual([]);
  });

  it('would catch an unknown key and a missing icon', () => {
    expect.hasAssertions();
    const yaml = { interface: { icon_small: './assets/gone.png' }, policy: { implicit: false } };
    expect(openaiProblems('openai.yaml', yaml, () => false)).toStrictEqual([
      "openai.yaml: unknown key 'policy.implicit'",
      "openai.yaml: interface.icon_small './assets/gone.png' does not exist",
    ]);
  });
});

describe('cross-references between the skill files', () => {
  it('link only to files that exist, outside code examples', async () => {
    expect.hasAssertions();
    const docs = await markdown();
    const problems = [...docs].flatMap(([file, text]) => linkProblems(file, text, existsInSkill));
    expect(problems).toStrictEqual([]);
  });

  it('would catch a missing or escaping link, resolved from the linking file, but not code', () => {
    expect.hasAssertions();
    const text =
      '[a](B.md) [b](A.md) [c](../../x.md) [d](../A.md)\n\n```md\n[e](/abs/f.ts:1)\n```\n';
    expect(linkProblems('sub/C.md', text, inFixture)).toStrictEqual([
      "sub/C.md: link to missing file 'A.md'",
      "sub/C.md: link to missing file '../../x.md'",
    ]);
  });

  it('cite only sections that exist', async () => {
    expect.hasAssertions();
    const docs = await markdown();
    const lookup = headingLookup(docs);
    expect([...docs].flatMap(([file, text]) => sectionProblems(file, text, lookup))).toStrictEqual(
      [],
    );
  });

  it('would catch a qualified or bare citation of a missing section', () => {
    expect.hasAssertions();
    const text =
      '## 1. One\n\nSee `B.md` §2, §3 of `B.md`, §1 and §4.\n\n```md\n## 4. Example\n```\n';
    const docs = new Map([
      ['A.md', text],
      ['B.md', '### 2. Two\n'],
    ]);
    expect(sectionProblems('A.md', text, headingLookup(docs))).toStrictEqual([
      'A.md: cites B.md §3, which has no section 3',
      'A.md: cites A.md §4, which has no section 4',
    ]);
  });
});

describe('skills/ content', () => {
  it('carries no credential-shaped string', async () => {
    expect.hasAssertions();
    const files = await textFiles(SKILLS);
    expect(files.size).toBeGreaterThan(1);
    expect([...files].flatMap(([file, text]) => credentialProblems(file, text))).toStrictEqual([]);
  });

  it('would catch a token but not a placeholder', () => {
    expect.hasAssertions();
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    expect(credentialProblems('A.md', 'Authorization: Bearer <token>')).toStrictEqual([]);
    expect(credentialProblems('A.md', `GH_TOKEN=${token}`)).toHaveLength(1);
  });
});
