import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

// Runs the built CLI inside a real pseudo-terminal, so a test sees what a person at a terminal
// sees: stderr is a TTY, the window has a width, and Ctrl-C reaches the process through the
// terminal driver as SIGINT, not through a kill call. Python's `pty.fork()` does all of that in
// the standard library; Node has no PTY of its own. POSIX only.

const PTY_DRIVER = String.raw`
import fcntl, json, os, pty, select, struct, sys, termios, time
spec = json.loads(sys.argv[1])
pid, fd = pty.fork()
if pid == 0:
    os.execvpe(spec["argv"][0], spec["argv"], spec["env"])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, spec["columns"], 0, 0))
started = time.monotonic()
interrupt_at = spec.get("interruptAfterMs")
chunks, status = [], None

def read_available(timeout):
    ready, _, _ = select.select([fd], [], [], timeout)
    if not ready:
        return False
    try:
        data = os.read(fd, 65536)
    except OSError:
        return None
    if not data:
        return None
    chunks.append(data)
    return True

while status is None:
    if interrupt_at is not None and (time.monotonic() - started) * 1000 >= interrupt_at:
        os.write(fd, b"\x03")
        interrupt_at = None
    if read_available(0.05) is None:
        break
    done, st = os.waitpid(pid, os.WNOHANG)
    if done:
        status = st
while read_available(0.05):
    pass
if status is None:
    _, status = os.waitpid(pid, 0)
print(json.dumps({"exitCode": os.waitstatus_to_exitcode(status), "output": b"".join(chunks).decode("utf-8", "replace")}))
`;

type PtyRun = { exitCode: number; output: string };

type PtySpec = {
  argv: readonly string[];
  columns?: number;
  env: NodeJS.ProcessEnv;
  interruptAfterMs?: number;
};

const DEFAULT_COLUMNS = 100;
const OUTPUT_LIMIT_BYTES = 16_777_216;
const EXECUTABLE = 0o755;

const runInPty = async (spec: PtySpec): Promise<PtyRun> => {
  const { stdout } = await promisify(execFile)(
    'python3',
    ['-c', PTY_DRIVER, JSON.stringify({ columns: DEFAULT_COLUMNS, ...spec })],
    { maxBuffer: OUTPUT_LIMIT_BYTES },
  );
  return JSON.parse(stdout) as PtyRun;
};

/** A `git` that waits `delaySeconds` before running the real one, and records its pid, so a test
 * can make a step slow enough to see and check the process is gone afterwards. */
const slowGitDir = async (realGit: string, delaySeconds: number): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-slow-git-'));
  const script = `#!/bin/sh\necho $$ >> "${dir}/pids"\nsleep ${delaySeconds}\nexec "${realGit}" "$@"\n`;
  await writeFile(join(dir, 'git'), script);
  await chmod(join(dir, 'git'), EXECUTABLE);
  return dir;
};

export { runInPty, slowGitDir };
export type { PtyRun };
