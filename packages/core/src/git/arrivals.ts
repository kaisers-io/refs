import { basename, dirname } from 'node:path';
import type { Runner } from '../proc/runner.ts';

// Which directories a sync range ADDED a package manifest to.
//
// This is the one honest answer to "did upstream gain a package?". The alternative — comparing a
// scan of the checkout against the configured entries — cannot distinguish a package that just
// arrived from one the ref's owner deliberately never tracked, because there is no inventory of
// what was there before. The sync range is that inventory: `syncRef` already knows the sha the
// checkout was on and the one it moved to, and git can say what appeared between them.
//
// Best-effort by design. Every failure resolves to "nothing arrived" rather than an error: this
// only ever ADDS a report to a sync that already succeeded, and a range git cannot walk (a
// shallow clone whose old sha is no longer reachable, most commonly) is a failure to look, never
// evidence that a package is missing.

const PACKAGE_MANIFEST = 'package.json';
const SUCCESS_EXIT_CODE = 0;
const ROOT_DIR = '.';

type ArrivalsOpts = {
  dir: string;
  from: string;
  to: string;
};

/** `*package.json` narrows what git prints; `basename` is what makes it exact — the pathspec
 * would also match `mypackage.json`. */
const isPackageManifest = (path: string): boolean => basename(path) === PACKAGE_MANIFEST;

const addedPackageDirs = async (runner: Runner, opts: ArrivalsOpts): Promise<string[]> => {
  if (opts.from === opts.to) {
    return [];
  }
  // `--` for the same reason `cloneRepo` and `git remote set-url` use it: end option parsing so
  // the pathspec can only be read as a pathspec.
  const result = await runner.run(
    'git',
    ['diff', '--name-only', '--diff-filter=A', `${opts.from}..${opts.to}`, '--', '*package.json'],
    { cwd: opts.dir },
  );
  if (result.exitCode !== SUCCESS_EXIT_CODE) {
    return [];
  }
  const dirs = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && isPackageManifest(line))
    .map((line) => dirname(line))
    // The repository root is never a workspace member — `unregisteredRoot` owns that case, and it
    // needs no diff to find it.
    .filter((dir) => dir !== ROOT_DIR);
  return [...new Set(dirs)].toSorted();
};

export { addedPackageDirs };
