import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { join } from 'node:path';

// The process-execution surface, pinned rather than described.
//
// Every argument refs hands to git is built from values that come from outside — a repository url,
// a ref key, a package path out of a third-party manifest, a branch name out of an upstream's HEAD.
// None of them is shell-quoted on the way in, and that is only correct because there is no shell:
// `spawn` with an argv array performs an execve, so a `;` or a `$(…)` inside an argument stays
// data. Measured: a `core.hooksPath` value carrying `; touch <file>` creates no file.
//
// That property is invisible at the call sites that rely on it, and it is one edit away from being
// untrue — `execSync` has no `shell` option because it IS a shell, and `spawn('sh', ['-c', text])`
// needs no option at all. Code scanning reports this surface (`js/shell-command-injection-from-
// environment`, `js/indirect-command-line-injection`, `js/shell-command-constructed-from-input`)
// and cannot see which of the two it is looking at, so these cases say which, in a form that fails
// when it stops being true.
//
// What they do NOT claim: that git cannot be made to run something. git executes commands named by
// its own options — `--upload-pack` on `clone` and `fetch` — and an argv array does not change
// that. Those verbs take only fixed arguments here, and the clone terminates its option list with
// `--`; `option-injection.test.ts` covers that separately. This file is about the shell.

const SRC = join(import.meta.dirname, '..', '..', 'src');
/** The one module allowed to start a process. */
const RUNNER = 'proc/runner.ts';
/** Always a shell, whatever is passed: no argv form, no `shell` option to turn off. */
const SHELL_APIS = ['exec', 'execSync', 'execFile', 'execFileSync', 'spawnSync'];

const sourceFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  const files = entries
    .filter((entry) => !entry.isDirectory() && entry.name.endsWith('.ts'))
    .map((entry) => join(dir, entry.name));
  const nested = await Promise.all(directories.map((entry) => sourceFiles(join(dir, entry.name))));
  return [...files, ...nested.flat()];
};

const productionSources = async (): Promise<{ path: string; text: string }[]> => {
  const files = await sourceFiles(SRC);
  return Promise.all(
    files.map(async (path) => ({
      path: path.slice(SRC.length + 1).replaceAll('\\', '/'),
      text: await readFile(path, 'utf8'),
    })),
  );
};

/** A `child_process` import that brings in a VALUE. A `import type { ChildProcess }` does not
 * start anything, and three modules legitimately have one. */
const IMPORTS_VALUE = /^import\s+(?!type\b)[^;]*from\s+'node:child_process';/mu;

describe('the process-execution surface', () => {
  it('starts a process in exactly one module', async () => {
    expect.hasAssertions();

    const sources = await productionSources();
    const starters = sources
      .filter((file) => IMPORTS_VALUE.test(file.text))
      .map((file) => file.path);

    // Not a style rule. Every guard that keeps a value out of a command — the `--` terminators, the
    // url canonicalisation, the hooks-path ownership — is written once, at this seam. A second
    // entry point is a second place to remember all of them.
    expect(starters).toStrictEqual([RUNNER]);
  });

  it('never reaches for an API that is a shell by construction', async () => {
    expect.hasAssertions();

    const sources = await productionSources();
    const offenders = sources.flatMap((file) =>
      SHELL_APIS.filter((api) =>
        new RegExp(String.raw`\b${api}\b[^\n]*from\s+'node:child_process'`, 'u').test(file.text),
      ).map((api) => `${file.path}: ${api}`),
    );

    // `execSync('git ' + value)` is the shape the whole quoting discipline assumes does not exist.
    // It has no `shell: false` to reach for, so nothing downstream can make it safe.
    expect(offenders).toStrictEqual([]);
  });

  it('spells the shell option out, as a literal, where the process starts', async () => {
    expect.hasAssertions();

    const runner = await readFile(join(SRC, RUNNER), 'utf8');
    // Line comments are stripped first: the module's own header says "never `shell: true`", which
    // is the right thing for it to say and the wrong thing for this to read as code.
    const code = runner.replaceAll(/^\s*\/\/.*$/gmu, '');

    // Every value the option is given, rather than "no value that is not `false`" — a negative
    // lookahead after `\s*` matches at the space, since the quantifier can take nothing.
    const values = [...code.matchAll(/shell:\s*(?<value>\w+)/gu)].map(
      (match) => match.groups?.['value'],
    );

    // `false` is Node's default, so this is about the next reader and the next edit rather than
    // about runtime behaviour — and a literal cannot be flipped by a spread that arrives later.
    expect(values).toStrictEqual(['false']);
  });
});

describe('an argument that looks like shell syntax', () => {
  it('reaches the child as one argument, unchanged', async () => {
    expect.hasAssertions();

    // The assertion is what ARRIVED, not that a marker file is absent: absence also holds for a
    // command that failed outright, which would pass while proving nothing.
    const hostile = "; touch /tmp/pwned && echo $(id) `whoami` 'quoted' \\\\escaped";
    const result = await new SpawnRunner().run('node', [
      '-e',
      'process.stdout.write(process.argv[1] ?? "")',
      hostile,
    ]);

    expect(result.stdout).toBe(hostile);
    expect(result.exitCode).toBe(0);
  });

  it('does not let a semicolon start a second command', async () => {
    expect.hasAssertions();

    // Under a shell this prints `one` and then runs `echo two`. As argv it prints the whole thing.
    const value = 'one; echo two';
    const result = await new SpawnRunner().run('node', [
      '-e',
      'process.stdout.write(process.argv[1] ?? "")',
      value,
    ]);

    expect(result.stdout).toBe(value);
  });
});
