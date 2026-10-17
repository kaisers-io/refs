// Bound ALL Git children, since even `show`, `checkout` and `reset` can lazy-fetch a missing
// blob in a partial clone. The generous ten-minute default includes credential helpers and
// transport setup; callers can explicitly supply a narrower deadline for their operation.
const DEFAULT_GIT_TIMEOUT_MS = 600_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

const gitTimeout = (cmd: string, explicit?: number): number | undefined => {
  if (cmd !== 'git' || explicit !== undefined) {
    return explicit;
  }
  const configured = process.env['REFS_GIT_TIMEOUT_MS'];
  if (configured === undefined) {
    return DEFAULT_GIT_TIMEOUT_MS;
  }
  const value = Number(configured);
  if (!/^\d+$/u.test(configured) || !Number.isSafeInteger(value) || value > MAX_TIMEOUT_MS) {
    throw new Error('REFS_GIT_TIMEOUT_MS must be an integer from 0 to 2147483647 (0 disables it)');
  }
  return value === 0 ? undefined : value;
};

export { DEFAULT_GIT_TIMEOUT_MS, gitTimeout };
