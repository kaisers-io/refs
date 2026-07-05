import type { RefEntry, Settings } from './schemas/config.ts';

// Resolution: ref override ?? global setting. Built-in defaults are already applied by
// `zSettings` when the config was parsed, so `settings` is always fully populated.
const resolveSetting = <Key extends keyof Settings>(
  key: Key,
  ref: RefEntry | undefined,
  settings: Settings,
): Settings[Key] => (ref?.[key] as Settings[Key] | undefined) ?? settings[key];

export { resolveSetting };
