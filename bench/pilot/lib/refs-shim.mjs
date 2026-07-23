// Full-only refs shim + per-run refs-compliance logging.
//
// The `full`-vs-control token contrast only means "the effect of the refs
// commands" if the control rungs cannot reach `refs`. So we (a) put `refs`
// behind a Full-only shim dir on PATH and (b) MEASURE the isolation: the shim
// logs every invocation, and each rung records `command -v refs`. Control-rung
// leakage becomes data, not an assumption.
//
// PATH isolation: `basePath` is the ambient PATH with the real refs dir removed,
// so `refs` is unreachable everywhere by default. `rungEnv('full')` prepends the
// shim dir, so only the full rung resolves `refs` (to the shim, which logs then
// execs the real refs). The node running the harness (process.execPath) is used
// to exec the real refs, so the shim never needs node on PATH.

import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const FULL = 'full';
const SHIM_NAME = 'refs';
const SHIM_PREFIX = 'refs-shim-';
const EXECUTABLE_MODE = 0o755;
const EMPTY = '';

// PATH for a rung: the shim dir is prepended only for `full`; controls get the
// refs-stripped basePath so `refs` cannot resolve at all.
const pathForRung = (rung, shimDir, basePath) => {
  if (rung === FULL) {
    return `${shimDir}${delimiter}${basePath}`;
  }
  return basePath;
};

// `REFS_LOG` is set only when a logPath is supplied (the pinned test builds env
// without one and asserts on PATH alone).
const rungEnv = (rung, { basePath, logPath, shimDir }) => {
  const env = { PATH: pathForRung(rung, shimDir, basePath) };
  if (logPath) {
    env.REFS_LOG = logPath;
  }
  return env;
};

// The shim is a tiny CommonJS node script (the shim dir has no package.json, so a
// bare `refs` file loads as CJS). It execs the real refs with inherited stdio so
// the agent sees refs's real stdout/stderr unmodified, then appends JSON lines to
// REFS_LOG (or the baked fallback) — never to stdout, so refs output stays clean.
// It logs a `phase:"start"` line BEFORE spawning and a `phase:"end"` line on close;
// a killed/hung refs then leaves a start with no matching end (completion-only
// logging would have missed it entirely).
const shimScript = (refsBinReal, logPath) =>
  `#!${process.execPath}
const { spawn } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const REFS_BIN = ${JSON.stringify(refsBinReal)};
const BAKED_LOG = ${JSON.stringify(logPath)};
const start = Date.now();
const argv = process.argv.slice(2);
const target = process.env.REFS_LOG || BAKED_LOG;
const log = (obj) => {
  if (!target) return;
  try {
    appendFileSync(target, JSON.stringify(obj) + '\\n');
  } catch {}
};
log({ ts: new Date().toISOString(), argv, phase: 'start' });
const child = spawn(process.execPath, [REFS_BIN, ...argv], { stdio: 'inherit' });
child.on('close', (code) => {
  const exit = code === null ? 0 : code;
  log({ ts: new Date().toISOString(), argv, exit, ms: Date.now() - start, phase: 'end' });
  process.exit(exit);
});
`;

// Writes an executable `refs` shim into shimDir. `refsBinReal` is the repo's
// packages/cli/bin/refs.mjs absolute path; logPath is the baked fallback log
// (REFS_LOG, set per-run, takes precedence).
const makeShim = async (shimDir, refsBinReal, logPath) => {
  const shimPath = join(shimDir, SHIM_NAME);
  await writeFile(shimPath, shimScript(refsBinReal, logPath ?? EMPTY));
  await chmod(shimPath, EXECUTABLE_MODE);
};

const readLog = async (logPath) => {
  try {
    return await readFile(logPath, 'utf8');
  } catch {
    // Missing log (control rungs never invoke refs) → no calls.
    return EMPTY;
  }
};

// MEASUREMENT BLIND SPOT: refsCalls (this log) and refsOnPath (below) only detect
// PATH-mediated `refs` invocations that resolve through the shim. The real
// packages/cli/bin/refs.mjs is never moved or removed, so an agent invoking it by
// absolute path (`node /abs/.../refs.mjs ...`) bypasses the shim entirely: no log
// line is written, and refsOnPath still reads empty for that rung. So "no calls
// logged + refs not on PATH" proves no PATH-resolved leak, NOT zero leak. The
// residual is bounded by (a) Task 1's self-contained preamble giving control
// agents no reason to reach for refs at all, and (b) the persisted per-run
// transcript — but transcript visibility is MODEL-SPECIFIC: Codex's JSONL `raw`
// records command_execution events, so an absolute-path `node .../refs.mjs` call
// shows there; Claude's `-p --output-format json` `raw` carries only the final
// result + usage, NOT the tool trajectory, so an absolute-path call is NOT visible
// for Claude on post-hoc inspection.
//
// Parses the JSONL invocation log (a phase:"start" line per call, plus a
// phase:"end" line once it exits); a missing file yields [].
const refsCalls = async (logPath) => {
  const text = await readLog(logPath);
  return text
    .split('\n')
    .filter((line) => line.trim() !== EMPTY)
    .map((line) => JSON.parse(line));
};

// The ambient PATH with `dir` removed (splits on the platform delimiter).
const basePathWithout = (pathValue, dir) =>
  pathValue
    .split(delimiter)
    .filter((entry) => entry !== dir)
    .join(delimiter);

// The directory holding the `refs` entry currently on PATH — dirname of the PATH
// resolution, NOT of its realpath (the on-PATH `refs` is a symlink into the repo;
// we must strip the symlink's dir, not the repo bin, from PATH).
const refsDirReal = async (exec) => {
  const { stdout } = await exec('sh', ['-c', 'command -v refs'], {});
  const resolved = stdout.trim();
  if (!resolved) {
    return EMPTY;
  }
  return dirname(resolved);
};

// Probes `command -v refs` under a given PATH — the full rung resolves the shim,
// controls resolve nothing (empty). This VERIFIES isolation per rung. Same blind
// spot as refsCalls above: an absolute-path invocation of the real refs.mjs is
// invisible to this probe.
const refsOnPath = async (exec, pathValue) => {
  const { stdout } = await exec('sh', ['-c', 'command -v refs'], {
    env: { ...process.env, PATH: pathValue },
  });
  return stdout.trim();
};

// Computes basePath (refs-stripped), creates a temp shim dir, and writes the shim.
// HOME is deliberately NOT overridden: refs resolves its checkout store under
// ~/.kaisers-io/refs/..., which the full rung needs. Skills-need is already removed
// by Task 1's self-contained preamble plus the CLIs' isolation flags, so no
// skill-discovery env var is stripped here (there is no clean one to strip); the
// residual is bounded by the self-contained preamble + the measured refs-compliance.
const setupShim = async (exec, refsBin) => {
  const refsDir = await refsDirReal(exec);
  const basePath = basePathWithout(process.env.PATH, refsDir);
  const shimDir = await mkdtemp(join(tmpdir(), SHIM_PREFIX));
  await makeShim(shimDir, refsBin, EMPTY);
  return { basePath, refsDir, shimDir };
};

export { basePathWithout, makeShim, refsCalls, refsDirReal, refsOnPath, rungEnv, setupShim };
