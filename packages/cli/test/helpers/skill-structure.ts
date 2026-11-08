// Structural rules for `skills/refs/`, as pure functions over file text so each one can be shown
// failing on a wrong input. Every function returns problems as `<file>: <what is wrong>`; an empty
// list means the rule holds. `skill-structure.test.ts` applies them to the shipped skill.

import { posix } from 'node:path';

type Json = Record<string, unknown>;

// The six fields of the Agent Skills specification (agentskills.io/specification).
const SPEC_KEYS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
// Claude Code reads these two (code.claude.com/docs/en/skills). claude.ai uploads and the Skills
// API reject any field outside the specification; refs ships through neither, only through
// skill installers that copy the directory for Claude Code and Codex.
const CLAUDE_CODE_KEYS = ['argument-hint', 'disable-model-invocation'];
const FRONTMATTER_KEYS = new Set([...SPEC_KEYS, ...CLAUDE_CODE_KEYS]);
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;

// The keys Codex documents for `agents/openai.yaml` (learn.chatgpt.com/docs/build-skills).
const OPENAI_KEYS: Record<string, readonly string[]> = {
  dependencies: ['tools'],
  interface: [
    'display_name',
    'short_description',
    'icon_small',
    'icon_large',
    'brand_color',
    'default_prompt',
  ],
  policy: ['allow_implicit_invocation'],
};
const ICON_KEYS = ['icon_small', 'icon_large'];

const FENCED = /^```[\s\S]*?^```/gmu;
const INLINE_CODE = /`[^`\n]*`/gu;
const LINK = /\]\((?:<(?<angled>[^>]*)>|(?<plain>[^)\s]*))[^)]*\)/gu;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
// `FILE.md` §N, or §N of `FILE.md`. Any other §N cites the file it appears in.
const QUALIFIED = /`(?<before>[A-Z]+\.md)` §(?<n1>\d+)|§(?<n2>\d+) of `(?<after>[A-Z]+\.md)`/gu;
const SECTION = /§(?<n>\d+)/gu;
const NUMBERED_HEADING = /^#{2,3} (?<n>\d+)\. /gmu;
const CREDENTIALS: readonly RegExp[] = [
  /\bghp_[A-Za-z0-9]{36}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/u,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/u,
  /\bBearer [A-Za-z0-9._~+/-]{20,}/u,
];

const frontmatterProblems = (file: string, dir: string, frontmatter: Json): string[] => {
  const { description, name } = frontmatter;
  return [
    ...Object.keys(frontmatter)
      .filter((key) => !FRONTMATTER_KEYS.has(key))
      .map((key) => `${file}: unknown frontmatter key '${key}'`),
    ...(frontmatter['disable-model-invocation'] === true
      ? []
      : [`${file}: disable-model-invocation must be true`]),
    ...(typeof name === 'string' && NAME.test(name) && name.length <= MAX_NAME && name === dir
      ? []
      : [
          `${file}: name must be a lowercase-hyphenated name of at most 64 characters equal to '${dir}'`,
        ]),
    ...(typeof description === 'string' &&
    description.length > 0 &&
    description.length <= MAX_DESCRIPTION
      ? []
      : [`${file}: description must be 1 to 1024 characters`]),
  ];
};

const objectOr = (value: unknown): Json =>
  typeof value === 'object' && value !== null ? (value as Json) : {};

/** Unknown keys in `openai.yaml`, and icons whose file `exists` does not confirm. */
const openaiProblems = (file: string, yaml: Json, exists: (path: string) => boolean): string[] => {
  const unknown = Object.entries(yaml).flatMap(([group, value]) => {
    const allowed = OPENAI_KEYS[group];
    if (allowed === undefined) {
      return [`${file}: unknown key '${group}'`];
    }
    return Object.keys(objectOr(value))
      .filter((key) => !allowed.includes(key))
      .map((key) => `${file}: unknown key '${group}.${key}'`);
  });
  const icons = objectOr(yaml['interface']);
  const missing = ICON_KEYS.filter((key) => key in icons && !exists(String(icons[key]))).map(
    (key) => `${file}: interface.${key} '${String(icons[key])}' does not exist`,
  );
  return [...unknown, ...missing];
};

/** Relative link targets outside code that do not resolve, from the linking file's own directory,
 * to a file inside the skill that `exists` confirms. Paths are relative to the skill root. */
const linkProblems = (file: string, text: string, exists: (path: string) => boolean): string[] =>
  [...text.replaceAll(FENCED, '').replaceAll(INLINE_CODE, '').matchAll(LINK)]
    .map((match) => match.groups?.['angled'] ?? match.groups?.['plain'] ?? '')
    .map((target) => target.split('#')[0] ?? '')
    .filter((target) => target !== '' && !URL_SCHEME.test(target))
    .filter((target) => {
      const resolved = posix.normalize(posix.join(posix.dirname(file), target));
      return resolved.startsWith('../') || posix.isAbsolute(resolved) || !exists(resolved);
    })
    .map((target) => `${file}: link to missing file '${target}'`);

const headingsOf = (text: string): Set<string> =>
  new Set(
    [...text.replaceAll(FENCED, '').matchAll(NUMBERED_HEADING)].map(
      (match) => match.groups?.['n'] ?? '',
    ),
  );

/** Section references whose file has no `## N.` or `### N.` heading of that number. */
const sectionProblems = (
  file: string,
  text: string,
  headings: (target: string) => Set<string> | undefined,
): string[] => {
  const prose = text.replaceAll(FENCED, '');
  const qualified = [...prose.matchAll(QUALIFIED)].map((match) => ({
    number: match.groups?.['n1'] ?? match.groups?.['n2'] ?? '',
    target: match.groups?.['before'] ?? match.groups?.['after'] ?? '',
  }));
  const bare = [...prose.replaceAll(QUALIFIED, '').matchAll(SECTION)].map((match) => ({
    number: match.groups?.['n'] ?? '',
    target: file,
  }));
  return [...qualified, ...bare]
    .filter(({ number, target }) => !(headings(target)?.has(number) ?? false))
    .map(
      ({ number, target }) => `${file}: cites ${target} §${number}, which has no section ${number}`,
    );
};

const credentialProblems = (file: string, text: string): string[] =>
  CREDENTIALS.filter((pattern) => pattern.test(text)).map(
    (pattern) => `${file}: credential-shaped string matching ${String(pattern)}`,
  );

export {
  credentialProblems,
  frontmatterProblems,
  headingsOf,
  linkProblems,
  openaiProblems,
  sectionProblems,
};
export type { Json };
