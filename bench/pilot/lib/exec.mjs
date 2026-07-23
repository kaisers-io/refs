import { spawn } from 'node:child_process';

// Promise-returning subprocess seam for the real pilot run. Mirrors the FakeCli
// shape used in unit tests: exec(cmd, args, opts) -> { code, stderr, stdout }.
// A hung child is SIGKILLed after opts.timeoutMs so one stall cannot freeze a
// long unattended run; the timed-out call resolves with TIMEOUT_CODE.
const DEFAULT_TIMEOUT_MS = 360_000;
const TIMEOUT_CODE = -1;

const spawnExec = (cmd, args, opts) =>
  // eslint-disable-next-line promise/avoid-new -- wrapping child_process events needs a constructed Promise
  new Promise((resolve, reject) => {
    // When opts.env is provided the CALLER passes a FULL env (spawn replaces, not
    // merges); undefined leaves the child inheriting process.env (unchanged behavior).
    const child = spawn(cmd, args, {
      cwd: opts?.cwd,
      env: opts?.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Decode as UTF-8 so a multi-byte char split across chunk boundaries is not corrupted.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: TIMEOUT_CODE, stderr: `${stderr}\n[timed out]`, stdout });
    }, opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, stdout });
    });
  });

export { spawnExec };
