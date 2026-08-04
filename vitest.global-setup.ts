// Fails the whole run immediately under an unsupported Node.js. The CLI's bin stub gates on
// >=24.2 (see the rationale comment in packages/cli/bin/refs.mjs), so on older runtimes the
// suite otherwise dies as four confusing assertion failures deep inside the bin-stub/doctor
// tests (the stub's version error where the tests expect real output) instead of one clear
// message naming the actual problem.
const MIN_SUPPORTED_MAJOR = 24;
const MIN_SUPPORTED_MINOR = 2;

const globalSetup = (): void => {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (
    major > MIN_SUPPORTED_MAJOR ||
    (major === MIN_SUPPORTED_MAJOR && minor >= MIN_SUPPORTED_MINOR)
  ) {
    return;
  }
  throw new Error(
    `the test suite requires Node.js >=${MIN_SUPPORTED_MAJOR}.${MIN_SUPPORTED_MINOR} (same as the refs CLI) — you are running ${process.versions.node}`,
  );
};

export default globalSetup;
