// The result is capped after doubling.
// eslint-disable-next-line no-magic-numbers -- literal fixture behavior is the evidence under test
export const policy = (input) => Math.min(input * 2, 6);
