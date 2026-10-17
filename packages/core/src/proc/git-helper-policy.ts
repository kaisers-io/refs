import { basename, delimiter, isAbsolute, relative, sep } from 'node:path';
import type { ConfigEntry } from './git-config-graph.ts';
import { assertConfigPathProvenance } from './git-config-missing.ts';
import { canonicalRoot } from './git-config-paths.ts';
import { windowsHomeCandidates } from './git-config-roots-env.ts';

// Authentication tools are trusted programs, not sandboxed programs. This refuses identifiable
// reference-relative loaders and search paths; it does not prove arbitrary helper internals safe.
const CONFIG_HELPERS = /^(?:credential(?:\..*)?\.helper|core\.(?:sshcommand|gitproxy|askpass))$/su;
const ENV_HELPERS = new Set(['GIT_SSH_COMMAND', 'GIT_PROXY_COMMAND']);
const DIRECT_HELPERS = new Set(['GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_SSH', 'GIT_ASK_YESNO']);
const CURRENT_DIRECTORY = /\$(?:PWD|\{PWD\}|\(\s*pwd\s*\))|%CD%/iu;
const SHELL_WORDS = /"[^"]*"|'[^']*'|[^\s"']+/gu;
const SHELL_CONTROL = /[$`;|&<>(){}\r\n]/u;
const SSH_COMMAND_OPTIONS =
  /^(?:proxycommand|localcommand|knownhostscommand|include|pkcs11provider|securitykeyprovider)(?:=|\s|$)/iu;
const INTERPRETER =
  /^(?:sh|bash|dash|zsh|fish|ksh|csh|tcsh|python[0-9.]*|py|perl[0-9.]*|ruby|node|nodejs|deno|bun|cmd|powershell|pwsh)(?:\.exe)?$/iu;
const INTERPRETER_OPTION = /^\/[a-z](?:$|:)/iu;
const HELPER_FAILURE =
  'Git helper configuration can load reference content; use trusted external helpers and absolute search paths';

type HelperContext = { env: NodeJS.ProcessEnv; roots: readonly string[] };

const helperFailure = (): Error => new Error(HELPER_FAILURE);
const envName = (key: string): string => (process.platform === 'win32' ? key.toUpperCase() : key);
const envValue = (env: NodeJS.ProcessEnv, key: string): string | undefined => {
  const entries = Object.entries(env).filter(([name]) => envName(name) === key);
  if (entries.length > 1) {
    throw helperFailure();
  }
  return entries[0]?.[1];
};
const contains = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

const externalPath = async (path: string, roots: readonly string[]): Promise<void> => {
  if (
    !isAbsolute(path) ||
    (process.platform === 'win32' && !/^(?:[a-z]:[\\/]|[\\/]{2})/iu.test(path))
  ) {
    throw helperFailure();
  }
  try {
    const canonical = await canonicalRoot(path);
    if (roots.some((root) => contains(root, canonical))) {
      throw helperFailure();
    }
    await assertConfigPathProvenance(path, {
      cwd: process.cwd(),
      metadata: [],
      protectedRoots: roots,
    });
  } catch {
    throw helperFailure();
  }
};

const canonicalRoots = (roots: readonly string[]): Promise<string[]> =>
  Promise.all(roots.map((root) => canonicalRoot(root)));

// Validate before ANY Git child, including config/version queries: Git itself and its built-in
// transport helpers can otherwise be selected from a reference directory before inventory runs.
const assertGitSearchPaths = async (
  context: HelperContext,
  platform: NodeJS.Platform = process.platform,
): Promise<void> => {
  const roots = await canonicalRoots(context.roots);
  const path = envValue(context.env, 'PATH');
  const execPath = envValue(context.env, 'GIT_EXEC_PATH');
  const paths = path === undefined ? [] : path.split(delimiter);
  if (execPath !== undefined) {
    paths.push(execPath);
  }
  if (platform === 'win32' && !envValue(context.env, 'MSYSTEM')) {
    paths.push(...windowsHomeCandidates(context.env).map((home) => `${home}/bin`));
  }
  await Promise.all(paths.map((candidate) => externalPath(candidate, roots)));
};

const wordPath = (word: string, env: NodeJS.ProcessEnv): string => {
  const unquoted = word.replaceAll(/["']/gu, '').replace(/^!/u, '');
  const path =
    unquoted.startsWith('-') && unquoted.includes('=')
      ? unquoted.slice(unquoted.indexOf('=') + 1)
      : unquoted;
  if (path.startsWith('~/')) {
    const home = envValue(env, 'HOME') ?? envValue(env, 'USERPROFILE');
    if (home === undefined) {
      throw helperFailure();
    }
    return `${home}/${path.slice('~/'.length)}`;
  }
  return path;
};

const assertCommandWord = async (word: string, context: HelperContext): Promise<void> => {
  const path = wordPath(word.replace(/^-F(?=.)/u, ''), context.env);
  if (isAbsolute(path)) {
    await externalPath(path, context.roots);
    return;
  }
  // Bare command names resolve through the already-checked PATH. URL arguments are not local
  // paths. Interpreter and SSH file arguments have additional checks below.
  if ((path.includes('/') || path.includes('\\')) && !path.includes('://')) {
    throw helperFailure();
  }
};

const assertInterpreter = (words: readonly string[], env: NodeJS.ProcessEnv): void => {
  for (const [index, word] of words.entries()) {
    const program = basename(wordPath(word, env));
    if (program === 'eval') {
      throw helperFailure();
    }
    if (INTERPRETER.test(program) || program === '.' || program === 'source') {
      const script = words[index + 1];
      if (
        script === undefined ||
        INTERPRETER_OPTION.test(script) ||
        !isAbsolute(wordPath(script, env))
      ) {
        throw helperFailure();
      }
    }
  }
};

const commandWords = (command: string): string[] => {
  const text = command.replace(/^!/u, '');
  const words = text.match(SHELL_WORDS) ?? [];
  if (SHELL_CONTROL.test(text) || text.replaceAll(SHELL_WORDS, '').trim() !== '') {
    throw helperFailure();
  }
  // Quoting may surround a whole argument, but shell concatenation/escape syntax is unsupported.
  if (words.join(' ') !== text.trim().replaceAll(/\s+/gu, ' ') && /["']/u.test(text)) {
    throw helperFailure();
  }
  return words;
};

const assertSshArguments = (words: readonly string[], env: NodeJS.ProcessEnv): void => {
  for (const [index, word] of words.entries()) {
    const value = word.replaceAll(/["']/gu, '');
    if (value.startsWith('-F')) {
      const config = value === '-F' ? words[index + 1] : value.slice('-F'.length);
      if (config === undefined || !isAbsolute(wordPath(config, env))) {
        throw helperFailure();
      }
    }
    const option = value === '-o' ? words[index + 1] : value.replace(/^-o/u, '');
    if (option !== undefined && SSH_COMMAND_OPTIONS.test(wordPath(option, env))) {
      throw helperFailure();
    }
  }
};

const assertCommand = async (command: string, context: HelperContext): Promise<void> => {
  const words = commandWords(command);
  assertInterpreter(words, context.env);
  assertSshArguments(words, context.env);
  await Promise.all(words.map((word) => assertCommandWord(word, context)));
};

const assertDirectHelper = async (path: string, context: HelperContext): Promise<void> => {
  if (isAbsolute(path)) {
    await externalPath(path, context.roots);
    return;
  }
  if (path.includes('/') || path.includes('\\') || CURRENT_DIRECTORY.test(path)) {
    throw helperFailure();
  }
};

const directHelpers = async (
  entries: readonly ConfigEntry[],
  context: HelperContext,
): Promise<void> => {
  const paths = entries.flatMap(({ key, value }) =>
    key === 'core.askpass' && value !== undefined ? [value] : [],
  );
  paths.push(
    ...Object.entries(context.env).flatMap(([key, value]) =>
      DIRECT_HELPERS.has(envName(key)) && value !== undefined ? [value] : [],
    ),
  );
  await Promise.all(paths.map((path) => assertDirectHelper(path, context)));
};

const assertGitHelpers = async (
  entries: readonly ConfigEntry[],
  context: HelperContext,
): Promise<void> => {
  const roots = await canonicalRoots(context.roots);
  const commands = entries
    .filter(({ key }) => key !== 'core.askpass' && CONFIG_HELPERS.test(key))
    .flatMap(({ value }) => (value === undefined ? [] : [value]));
  commands.push(
    ...Object.entries(context.env).flatMap(([key, value]) =>
      ENV_HELPERS.has(envName(key)) && value !== undefined ? [value] : [],
    ),
  );
  await directHelpers(entries, { ...context, roots });
  await Promise.all(commands.map((command) => assertCommand(command, { ...context, roots })));
};

export { externalPath as assertExternalPath, assertGitHelpers, assertGitSearchPaths };
