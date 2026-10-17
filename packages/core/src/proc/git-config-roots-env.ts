import { configFailure } from './git-config-records.ts';

const ROOT_VARIABLES = new Set([
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'PROGRAMDATA',
  'USERPROFILE',
  'XDG_CONFIG_HOME',
]);

const rootEnvironment = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): NodeJS.ProcessEnv => {
  if (platform !== 'win32') {
    return env;
  }
  const selected: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    const normalized = key.toUpperCase();
    if (ROOT_VARIABLES.has(normalized)) {
      if (Object.hasOwn(selected, normalized)) {
        throw configFailure();
      }
      selected[normalized] = value;
    }
  }
  return selected;
};

const homeCandidates = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] => {
  if (env['HOME'] !== undefined) {
    return [env['HOME']];
  }
  if (platform !== 'win32') {
    return [];
  }
  const drive = env['HOMEDRIVE'];
  const path = env['HOMEPATH'];
  // Git for Windows chooses the drive/path if it exists, otherwise USERPROFILE. Inspect both:
  // creation of the clone directory can change which candidate exists after this preflight.
  return [
    drive !== undefined && path !== undefined ? `${drive}${path}` : undefined,
    env['USERPROFILE'],
  ].filter((candidate): candidate is string => candidate !== undefined);
};

const configRootCandidates = (
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string[] => {
  const env = rootEnvironment(environment, platform);
  // Git for Windows before 2.24 also reads this environment-derived system config.
  // Inventory its possible future location conservatively without assuming a Git version.
  const programData = platform === 'win32' ? env['PROGRAMDATA'] : undefined;
  const roots = [
    env['GIT_CONFIG_SYSTEM'],
    env['GIT_CONFIG_GLOBAL'],
    programData === undefined ? undefined : `${programData}/Git/config`,
  ].filter((path): path is string => path !== undefined);
  if (env['GIT_CONFIG_GLOBAL'] !== undefined) {
    return roots;
  }
  const homes = homeCandidates(env, platform);
  const xdg = env['XDG_CONFIG_HOME'];
  return [
    ...roots,
    ...homes.map((home) => `${home}/.gitconfig`),
    ...(xdg === undefined || xdg === ''
      ? homes.map((home) => `${home}/.config/git/config`)
      : [`${xdg}/git/config`]),
  ];
};

const windowsHomeCandidates = (env: NodeJS.ProcessEnv): string[] =>
  homeCandidates(rootEnvironment(env, 'win32'), 'win32');

export { configRootCandidates, windowsHomeCandidates };
