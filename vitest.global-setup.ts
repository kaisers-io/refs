import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Fails the whole run immediately under an unsupported Node.js. The CLI's bin stub gates on
// >=24.2 (see the rationale comment in packages/cli/bin/refs.mjs), so on older runtimes the
// suite otherwise dies as four confusing assertion failures deep inside the bin-stub/doctor
// tests (the stub's version error where the tests expect real output) instead of one clear
// message naming the actual problem.
const MIN_SUPPORTED_MAJOR = 24;
const MIN_SUPPORTED_MINOR = 2;

const assertSupportedNode = (): void => {
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

// The CLI bundle, built once per run before any test file starts. Tests that run the shipped
// `refs` (the spinner on a pty, commands pasted into `sh`) read `packages/cli/dist/refs.mjs`, and
// must never read a stale one: `pnpm check` does not build. Each of those files used to build it
// itself, in parallel workers, and tsdown rewrites the file in place, so one file could load the
// bundle while another was writing it. An empty bundle is a module with no exports, which is how
// it failed in CI: `realContext is not a function`. About a second per run.
//
// `pnpm` is `pnpm.cmd` on Windows, which only a shell can start; the arguments are constant.
const buildCliBundle = async (): Promise<void> => {
  const exec = promisify(execFile);
  await exec('pnpm', ['--filter', '@kaisers-io/refs', 'build'], {
    cwd: import.meta.dirname,
    shell: process.platform === 'win32',
  });
};

const globalSetup = async (): Promise<void> => {
  assertSupportedNode();
  await buildCliBundle();
};

export default globalSetup;
