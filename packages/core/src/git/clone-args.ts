import type { CloneMode } from '../schemas/primitives.ts';
import { withCloneTemplate } from './filter-guard.ts';

// The argv for refs' `git clone` of a managed checkout (`repo.ts#cloneRepo`).
//
// `-c core.hooksPath=…` on the clone ITSELF, not afterwards. git applies a clone's `-c` once the
// new repository is initialized and BEFORE it fetches and checks out, so this is the only form
// that covers the checkout the clone performs. Setting it afterwards leaves that checkout
// governed by the ambient config: a user-level RELATIVE `core.hooksPath` (`.githooks`, say)
// resolves inside the tree being cloned, so an upstream-tracked hook of that name runs — during
// `add --dry-run`, before anyone has approved the ref. `-c` also persists into the new repo's
// local config, which is what the `git config` call in `cloneRepo` then only re-affirms.
// The interpolation is safe and both reasons are verified: there is no shell (`SpawnRunner`
// always spawns an argv array), and a newline in a `-c` value cannot smuggle a second setting —
// git 2.54 stores the whole string as ONE value. `hooksDir` is refs-owned in any case.
//
// The same setting goes in front of `clone` as well, at command scope. A clone's own `-c` is
// repository-local configuration, and command-scope configuration outranks it: an inherited
// `GIT_CONFIG_COUNT`/`GIT_CONFIG_PARAMETERS` naming `core.hooksPath` (both pass through to git
// on purpose, see `proc/child-env.ts`) would otherwise govern the clone's checkout. A top-level
// `-c` is appended after the inherited entries, so it is the one git applies; it is not
// persisted, which is why the clone's own `-c` stays to write the marker.
//
// `--template` names the private template `withCloneTemplate` (filter-guard.ts) builds, so content
// filters are already off for the initial checkout.
//
// `--` ends option parsing, so a url shaped like a flag can only be read as the repository to
// clone. git would otherwise honour `--upload-pack=<cmd>` and run it. `canonicalizeGitUrl`
// already refuses such urls, but only where a url is first accepted: `sync` re-reads it from
// config, which validates it as a non-empty string and nothing more. This makes the property
// hold at the call itself rather than resting on something having been checked earlier.

type CloneArgsOpts = {
  cloneUrl: string;
  dest: string;
  hooksDir: string;
  mode: CloneMode;
  templateDir: string;
};

const cloneArgs = (opts: CloneArgsOpts): string[] => {
  const hooksPath = `core.hooksPath=${opts.hooksDir}`;
  const filter = opts.mode === 'blobless' ? ['--filter=blob:none'] : [];
  return [
    '-c',
    hooksPath,
    'clone',
    '-q',
    `--template=${opts.templateDir}`,
    '-c',
    hooksPath,
    ...filter,
    '--',
    opts.cloneUrl,
    opts.dest,
  ];
};

/** Runs `run` with the clone argv for `opts` and a private template that lives as long as it. */
const withCloneArgs = <Result>(
  opts: Omit<CloneArgsOpts, 'templateDir'>,
  run: (args: string[]) => Promise<Result>,
): Promise<Result> => withCloneTemplate((templateDir) => run(cloneArgs({ ...opts, templateDir })));

export { cloneArgs, withCloneArgs };
