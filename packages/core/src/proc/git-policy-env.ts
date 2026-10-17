import { gitEnvironment } from './git-environment.ts';

const PROTOCOLS = ['https', 'http', 'ssh', 'git', 'file'];
const POLICY_VALUES = {
  REFS_GIT_POLICY_EMPTY: '',
  REFS_GIT_POLICY_FALSE: 'false',
  REFS_GIT_POLICY_TRUE: 'true',
};
const POLICY_KEYS = new Set(['GIT_ALLOW_PROTOCOL', ...Object.keys(POLICY_VALUES)]);

// Preserve a caller's stricter allowlist rather than expanding it. The CLI separately gates
// explicit local sources; file transport remains available to the private core API and URL
// rewrites. Custom/ext helpers are outside the supported execution boundary.
const allowedProtocols = (value: string | undefined): string =>
  value === undefined
    ? PROTOCOLS.join(':')
    : value
        .split(':')
        .filter((protocol) => PROTOCOLS.includes(protocol))
        .join(':');

const gitPolicyEnvironment = (
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv => {
  const entries = Object.entries(gitEnvironment(env, platform));
  const normalized = (key: string): string => (platform === 'win32' ? key.toUpperCase() : key);
  const allowlist = entries.find(([key]) => normalized(key) === 'GIT_ALLOW_PROTOCOL')?.[1];
  return {
    ...Object.fromEntries(entries.filter(([key]) => !POLICY_KEYS.has(normalized(key)))),
    ...POLICY_VALUES,
    GIT_ALLOW_PROTOCOL: allowedProtocols(allowlist),
  };
};

export { gitPolicyEnvironment };
