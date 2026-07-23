import {
  basePathWithout,
  makeShim,
  refsCalls,
  refsDirReal,
  refsOnPath,
  rungEnv,
  setupShim,
} from '../pilot/lib/refs-shim.mjs';
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { FakeCli } from './fake-cli.mjs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const cfg = { basePath: '/usr/bin:/bin', shimDir: '/shim' };
const EMPTY = '';
const FAKE_EXIT = 3;
const FIRST = 0;
const NO_CALLS = 0;
const ONE_CALL = 1;
// A completed invocation logs two lines: a phase:"start" and a phase:"end".
const TWO_LINES = 2;
const SHIM_ARGS = ['add', 'x'];

const endLine = (calls) => calls.find((call) => call.phase === 'end');
const startLine = (calls) => calls.find((call) => call.phase === 'start');

// A trivial fake "refs" that echoes its argv and exits non-zero, proving the shim
// forwards argv, passes stdout through untouched, and preserves the exit code.
const FAKE_REFS = 'process.stdout.write("hi " + process.argv.slice(2).join(","));process.exit(3);';

const runShim = (shimPath, args, logPath) =>
  // eslint-disable-next-line promise/avoid-new -- wrapping child_process events needs a constructed Promise
  new Promise((resolve) => {
    const child = spawn(shimPath, args, {
      env: { ...process.env, REFS_LOG: logPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('close', (code) => {
      resolve({ code, stdout });
    });
  });

const invokeShim = async (args) => {
  const dir = await mkdtemp(join(tmpdir(), 'shim-test-'));
  const refsBin = join(dir, 'fake-refs.mjs');
  const logPath = join(dir, 'log.jsonl');
  await writeFile(refsBin, FAKE_REFS);
  await makeShim(dir, refsBin, '');
  const result = await runShim(join(dir, 'refs'), args, logPath);
  const calls = await refsCalls(logPath);
  await rm(dir, { recursive: true });
  return { calls, result };
};

describe('rungEnv', () => {
  it('adds the shim dir to PATH only for full', () => {
    expect(rungEnv('full', cfg).PATH).toContain('/shim');
    expect(rungEnv('naive', cfg).PATH).not.toContain('/shim');
    expect(rungEnv('discipline', cfg).PATH).not.toContain('/shim');
  });

  it('sets REFS_LOG only when a logPath is supplied', () => {
    expect(rungEnv('full', { ...cfg, logPath: '/l' }).REFS_LOG).toBe('/l');
    expect(rungEnv('full', cfg).REFS_LOG).toBeUndefined();
  });
});

describe('basePathWithout', () => {
  it('removes the refs dir from PATH', () => {
    expect(basePathWithout('/a:/refs:/b', '/refs')).toBe('/a:/b');
  });
});

describe('refsDirReal', () => {
  it('returns the dirname of `command -v refs`, not its realpath', async () => {
    const RESOLVED = '/some/dir/v24/bin/refs';
    const fake = new FakeCli({ code: FIRST, stderr: EMPTY, stdout: `${RESOLVED}\n` });
    const dir = await refsDirReal(fake.exec.bind(fake));
    expect(dir).toBe('/some/dir/v24/bin');
    expect(fake.calls).toHaveLength(ONE_CALL);
    expect(fake.calls[FIRST].cmd).toBe('sh');
    expect(fake.calls[FIRST].args).toEqual(['-c', 'command -v refs']);
  });

  it('returns empty when refs is not resolvable', async () => {
    const fake = new FakeCli({ code: FIRST, stderr: EMPTY, stdout: EMPTY });
    const dir = await refsDirReal(fake.exec.bind(fake));
    expect(dir).toBe(EMPTY);
  });
});

describe('refsOnPath', () => {
  const PROBE_PATH = '/shim:/usr/bin';

  it('returns the trimmed resolution and forwards the probed PATH', async () => {
    const RESOLVED = '/shim/refs';
    const fake = new FakeCli({ code: FIRST, stderr: EMPTY, stdout: `${RESOLVED}\n` });
    const resolved = await refsOnPath(fake.exec.bind(fake), PROBE_PATH);
    expect(resolved).toBe(RESOLVED);
    expect(fake.calls[FIRST].opts.env.PATH).toBe(PROBE_PATH);
  });

  it('returns empty when the probed PATH cannot resolve refs', async () => {
    const fake = new FakeCli({ code: FIRST, stderr: EMPTY, stdout: EMPTY });
    const resolved = await refsOnPath(fake.exec.bind(fake), PROBE_PATH);
    expect(resolved).toBe(EMPTY);
  });
});

// `setupShim` composes refsDirReal (faked exec) with real fs (mkdtemp/writeFile/chmod),
// so it is tested end-to-end here rather than mocked apart: a FakeCli stands in for
// `command -v refs`, and the resulting shim dir is spawned for real against a fake
// refs binary, proving setupShim wires refsBin into a working, executable shim.
const SETUP_SHIM_REFS_DIR = '/fake/tools/refs-v9/bin';

const invokeSetupShim = async () => {
  const fake = new FakeCli({ code: FIRST, stderr: EMPTY, stdout: `${SETUP_SHIM_REFS_DIR}/refs\n` });
  const dir = await mkdtemp(join(tmpdir(), 'setup-shim-test-'));
  const refsBinReal = join(dir, 'fake-refs.mjs');
  await writeFile(refsBinReal, FAKE_REFS);
  const base = await setupShim(fake.exec.bind(fake), refsBinReal);
  const logPath = join(dir, 'log.jsonl');
  const result = await runShim(join(base.shimDir, 'refs'), SHIM_ARGS, logPath);
  const calls = await refsCalls(logPath);
  await Promise.all([rm(dir, { recursive: true }), rm(base.shimDir, { recursive: true })]);
  return { base, calls, result };
};

describe('setupShim', () => {
  it('builds a shim dir wired to the given refsBin, using the exec seam to resolve refsDir', async () => {
    const { base, calls, result } = await invokeSetupShim();
    expect(base.refsDir).toBe(SETUP_SHIM_REFS_DIR);
    expect(base.shimDir).toContain('refs-shim-');
    expect(result.stdout).toBe('hi add,x');
    expect(result.code).toBe(FAKE_EXIT);
    expect(calls).toHaveLength(TWO_LINES);
  });
});

describe('makeShim + refsCalls', () => {
  it('writes an executable shim that forwards argv/stdout/exit and logs start + end lines', async () => {
    const { calls, result } = await invokeShim(SHIM_ARGS);
    expect(result.stdout).toBe('hi add,x');
    expect(result.code).toBe(FAKE_EXIT);
    expect(calls).toHaveLength(TWO_LINES);
    // The start line is written before exec (catches killed/hung refs); the end
    // line carries the exit code once the child closes.
    expect(startLine(calls).argv).toEqual(SHIM_ARGS);
    expect(startLine(calls).phase).toBe('start');
    expect(endLine(calls).argv).toEqual(SHIM_ARGS);
    expect(endLine(calls).exit).toBe(FAKE_EXIT);
  });

  it('returns [] for a missing log', async () => {
    const calls = await refsCalls(join(tmpdir(), 'refs-shim-missing-xyz.jsonl'));
    expect(calls).toHaveLength(NO_CALLS);
  });
});
