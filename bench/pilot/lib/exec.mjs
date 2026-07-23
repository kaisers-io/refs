import { spawn } from 'node:child_process';

// Promise-returning subprocess seam for the real pilot run. Mirrors the FakeCli
// shape used in unit tests: exec(cmd, args, opts) -> { code, stderr, stdout }.
const spawnExec = (cmd, args, opts) =>
  // eslint-disable-next-line promise/avoid-new -- wrapping child_process events needs a constructed Promise
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts?.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stderr, stdout });
    });
  });

export { spawnExec };
