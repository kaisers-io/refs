// Git's local_repo_env list (environment.c), including the older super-prefix variable.
// Match sanitize_repo_env()'s exceptions: injected command-scope configuration is retained,
// along with authentication, transport, tracing and global/system configuration choices.
const REPOSITORY_VARIABLES = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
  'GIT_INTERNAL_SUPER_PREFIX',
  // Git for Windows can redirect these streams before main(), hiding configuration inventory.
  'GIT_REDIRECT_STDIN',
  'GIT_REDIRECT_STDOUT',
  'GIT_REDIRECT_STDERR',
]);

// Never modify process.env: refs may be embedded, or invoked from a Git hook that still needs
// its own repository context. Windows environment names are case-insensitive, unlike POSIX.
const gitEnvironment = (
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv => {
  const clean = Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => !REPOSITORY_VARIABLES.has(platform === 'win32' ? key.toUpperCase() : key),
    ),
  );
  const prompt = Object.keys(clean).find(
    (key) => (platform === 'win32' ? key.toUpperCase() : key) === 'GIT_TERMINAL_PROMPT',
  );
  if (prompt === undefined || clean[prompt] === undefined) {
    clean['GIT_TERMINAL_PROMPT'] = '0';
  }
  return clean;
};

export { gitEnvironment };
