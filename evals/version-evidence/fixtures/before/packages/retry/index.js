// Delay before the first retry, in milliseconds.
// eslint-disable-next-line no-magic-numbers -- literal fixture behavior is the evidence under test
export const retryDelay = (attempt, delayMs = 100) => delayMs * 2 ** attempt;
