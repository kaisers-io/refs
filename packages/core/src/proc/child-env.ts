// The environment every child process refs starts receives: the parent's, minus git's
// repository-locating variables.
//
// refs addresses a checkout by its path alone (`cwd`). git gives `GIT_DIR`, `GIT_WORK_TREE`,
// `GIT_INDEX_FILE` and their siblings precedence over the working directory, and git exports them
// to every hook it runs (githooks(5)). So `refs add` or `refs sync` started from a hook, an alias
// or a wrapper that exports them would run its git commands — `config core.hooksPath`,
// `reset --hard`, `clean -fd` — against the CALLER's repository instead of the checkout it named.
//
// The list mirrors git's own `local_repo_env` (environment.c), which is what
// `git rev-parse --local-env-vars` prints, and the rule mirrors git's `sanitize_repo_env()`
// (run-command.c): git clears exactly this set before it runs a command in another repository,
// and keeps `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT`. Those two carry command-scope
// configuration (`git -c`, `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>`) that CI systems use to
// inject credentials and `url.<base>.insteadOf` rewrites; dropping them would break clones there.
// Everything else — `GIT_SSH_COMMAND`, `GIT_ASKPASS`, `GIT_TERMINAL_PROMPT`, `GIT_TRACE*`,
// `GIT_CONFIG_GLOBAL`, proxies — is the user's configuration and passes through untouched.
//
// `GIT_INTERNAL_SUPER_PREFIX` is listed by gits older than 2.40 and is harmless to clear on newer
// ones. Windows environment names are case-insensitive, and a copy of `process.env` keeps whatever
// casing the variable was set with, so the match there ignores case.

const REPO_LOCAL_GIT_ENV: ReadonlySet<string> = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG',
  'GIT_DIR',
  'GIT_GRAFT_FILE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_INTERNAL_SUPER_PREFIX',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_REPLACE_REF_BASE',
  'GIT_SHALLOW_FILE',
  'GIT_WORK_TREE',
]);

const isRepoLocal = (name: string, platform: NodeJS.Platform): boolean =>
  REPO_LOCAL_GIT_ENV.has(platform === 'win32' ? name.toUpperCase() : name);

/** A copy of `env` without git's repository-locating variables. Never mutates `env`. */
const sanitizedChildEnv = (
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([name]) => !isRepoLocal(name, platform)));

export { REPO_LOCAL_GIT_ENV, sanitizedChildEnv };
