// The environment every child refs starts receives: the parent's, minus git's repository-locating
// variables.
//
// refs addresses a checkout by `cwd` alone, but git lets `GIT_DIR`, `GIT_WORK_TREE`,
// `GIT_INDEX_FILE`, `GIT_COMMON_DIR` and their siblings override the working directory, and git
// exports them to every hook. A `refs add` or `refs sync` started from a hook, an alias or a wrapper
// would therefore run its `config`, `status`, `reset --hard` and `clean -fd` against the CALLER's
// repository. Measured: `GIT_DIR=<other>/.git git config core.hooksPath …` run inside a fresh
// checkout writes the other repository's config and leaves the checkout's untouched.
//
// The list mirrors git's own `local_repo_env` (`git rev-parse --local-env-vars`), and the two
// exceptions mirror its `sanitize_repo_env()`: `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT`
// (with its `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>` pairs, which are not on the list at all)
// carry command-scope configuration, and CI injects credentials and `insteadOf` rewrites that way.
// `GIT_INTERNAL_SUPER_PREFIX` is on older gits' list and stays here so those are covered too.
//
// Deliberately NOT a blanket `GIT_*` strip: `GIT_SSH_COMMAND`, `GIT_ASKPASS`,
// `GIT_TERMINAL_PROMPT`, `GIT_TRACE*` and `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_NOSYSTEM` are the user's
// legitimate configuration of how git runs, not of which repository it runs on.
const REPOSITORY_LOCAL_GIT_VARIABLES: ReadonlySet<string> = new Set([
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

// Windows environment names are case-insensitive: `process.env.git_dir` there IS `GIT_DIR`, and git
// reads it as such. A copied plain object loses that, so the match has to be made explicitly. On
// every other platform `git_dir` is a different variable git never reads, and is left alone.
const isRepositoryLocal = (name: string, platform: NodeJS.Platform): boolean =>
  REPOSITORY_LOCAL_GIT_VARIABLES.has(platform === 'win32' ? name.toUpperCase() : name);

/** A copy of `env` without git's repository-locating variables. Never mutates `env`: the parent
 * process keeps its environment; only what refs hands to its children changes. */
const childEnv = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([name]) => !isRepositoryLocal(name, platform)));

export { REPOSITORY_LOCAL_GIT_VARIABLES, childEnv };
