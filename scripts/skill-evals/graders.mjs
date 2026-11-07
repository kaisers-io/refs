// Grades one Codex run with the graders an eval case declares for `claude plugin eval`. Only the
// grader types and options the suite uses are supported; anything else is rejected when the case
// loads, so a grader can never be skipped silently and pass by omission.

import { isAbsolute, join, normalize } from 'node:path';
import { readFile } from 'node:fs/promises';

const REGEX_TARGETS = new Set(['last_message', 'trace']);
const SHELL_WRAPPER = /^\/bin\/(?:ba|z)?sh -lc (?<script>[\s\S]+)$/u;
const QUOTED_PART = /'(?<single>[^']*)'|"(?<double>(?:[^"\\]|\\.)*)"|(?<bare>[^'"]+)/gu;
const COUNT_MATCH = /^count:(?<count>\d+)$/u;
const MATCH_MODES = new Set([undefined, 'contains', 'not_contains']);
const GLOB_PARTS = new Map([
  ['*', '[^/]*'],
  ['**', '.*'],
  ['**/', '(?:.*/)?'],
  ['?', '.'],
]);

/** Throws when a grader uses a type or option this adapter does not implement. */
const assertSupported = (caseName, grader) => {
  const { target, tool, type } = grader;
  const fileTarget = typeof target === 'object' && target?.source === 'file';
  const matchOk = MATCH_MODES.has(grader.match) || COUNT_MATCH.test(grader.match);
  const regexOk =
    type === 'regex' &&
    matchOk &&
    (target === undefined || REGEX_TARGETS.has(target) || fileTarget);
  const fileExistsOk = type === 'file_exists' && typeof grader.path === 'string';
  if (!regexOk && !fileExistsOk && !(type === 'tool_used' && tool === 'Bash')) {
    throw new Error(`${caseName}: grader "${grader.name}" is not supported by the Codex runner`);
  }
};

// Codex runs each command as `/bin/zsh -lc '<script>'`. Undo that one layer of shell quoting so a
// case's `input_match` sees the command an agent wrote, as it does under Claude's Bash tool. Any
// other form is left as it is: a grader then sees the raw string, which fails rather than guesses.
const commandOf = (raw) => {
  const script = SHELL_WRAPPER.exec(raw)?.groups.script;
  if (script === undefined) {
    return raw;
  }
  return [...script.matchAll(QUOTED_PART)]
    .map(
      ({ groups }) =>
        groups.single ?? groups.bare ?? groups.double.replaceAll(/\\(?<char>.)/gu, '$<char>'),
    )
    .join('');
};

const textFor = (target, run) => {
  if (target === undefined || target === 'last_message') {
    return run.lastMessage;
  }
  if (target === 'trace') {
    return run.trace;
  }
  const relative = normalize(target.path);
  if (isAbsolute(relative) || relative.startsWith('..')) {
    throw new Error(`file target ${target.path} leaves the run directory`);
  }
  return readFile(join(run.cwd, relative), 'utf8');
};

const gradeRegex = async (grader, run) => {
  const text = await textFor(grader.target, run);
  const found = text.match(new RegExp(grader.pattern, `g${grader.flags ?? ''}`)) ?? [];
  const match = grader.match ?? 'contains';
  const count = COUNT_MATCH.exec(match)?.groups.count;
  if (count !== undefined) {
    return {
      explanation: `${found.length} match(es), expected ${count}`,
      passed: found.length === Number(count),
    };
  }
  const passed = match === 'not_contains' ? found.length === 0 : found.length > 0;
  return { explanation: `${found.length} match(es) for ${match}`, passed };
};

const gradeToolUsed = (grader, run) => {
  const pattern = new RegExp(grader.input_match ?? '', 'u');
  const hits = run.commands.filter((command) => pattern.test(JSON.stringify({ command }))).length;
  const min = grader.min ?? 1;
  const max = grader.max ?? Number.POSITIVE_INFINITY;
  return {
    explanation: `Bash called ${hits}x (expected ${min}..${max})`,
    passed: hits >= min && hits <= max,
  };
};

// A glob over the run's created files, translated the way `claude plugin eval` does: `**/` is any
// number of directories, `**` anything, `*` anything but `/`, `?` one character.
const globToRegExp = (glob) => {
  const source = glob
    .split(/(?<wildcard>\*\*\/|\*\*|\*|\?)/u)
    .map((part) => GLOB_PARTS.get(part) ?? part.replaceAll(/[.+^${}()|[\]\\]/gu, String.raw`\$&`))
    .join('');
  return new RegExp(`^${source}$`, 'u');
};

// `files` are the paths created during the run, relative to its directory: what was not there when
// the scaffold finished. A file that existed and was changed is not among them, as under Claude.
const gradeFileExists = (grader, run) => {
  const pattern = globToRegExp(grader.path);
  const found = run.created.some((path) => pattern.test(path));
  const exists = grader.exists ?? true;
  return {
    explanation: `${grader.path} ${found ? 'created' : 'not created'} (expected ${exists ? 'created' : 'absent'})`,
    passed: found === exists,
  };
};

const GRADE = { file_exists: gradeFileExists, regex: gradeRegex, tool_used: gradeToolUsed };

/** A grader that cannot read its target fails, whatever its `match`: a missing file is no evidence. */
const grade = async (grader, run) => {
  try {
    const result = await GRADE[grader.type](grader, run);
    return { name: grader.name, ...result };
  } catch (error) {
    return {
      explanation: `grader could not run: ${error.message}`,
      name: grader.name,
      passed: false,
    };
  }
};

export { assertSupported, commandOf, grade };
