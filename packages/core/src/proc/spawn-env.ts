// The environment `SpawnRunner` (runner.ts) gives every child.
//
// git asks for a missing HTTPS username or password on `/dev/tty`, not on stdin, so the ignored
// stdin `SpawnRunner` spawns with does not stop it: with a controlling terminal and no credential
// helper, `refs add` sat at a prompt nobody was there to answer, holding the per-ref lock. An agent
// cannot answer it either. `GIT_TERMINAL_PROMPT=0` makes git fail at that point instead, and leaves
// credential helpers and `GIT_ASKPASS` working (https://git-scm.com/docs/git#Documentation/git.txt-GITTERMINALPROMPT).
//
// Only a default: a person who types an HTTPS password by hand sets `GIT_TERMINAL_PROMPT=1` and
// gets the prompt back. Any value they set is passed through untouched, empty included. The lookup
// goes through the environment object itself, which on Windows is `process.env`'s
// case-insensitive view, so a differently cased spelling counts as set there too.

import { childEnv as withoutRepositoryLocal } from './child-env.ts';

const TERMINAL_PROMPT_VARIABLE = 'GIT_TERMINAL_PROMPT';
const PROMPTS_DISABLED = '0';

// A copy of `process.env` is a plain object, case-sensitive even on Windows, so the lookup does not
// rely on the view: on Windows any spelling counts, and a second spelling is never added.
const isSet = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean =>
  platform === 'win32'
    ? Object.keys(env).some((name) => name.toUpperCase() === TERMINAL_PROMPT_VARIABLE)
    : env[TERMINAL_PROMPT_VARIABLE] !== undefined;

/** `env` with `GIT_TERMINAL_PROMPT=0` added when it is not set; `env` itself when it is. */
const childEnv = (
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv =>
  isSet(env, platform) ? env : { ...env, [TERMINAL_PROMPT_VARIABLE]: PROMPTS_DISABLED };

/** What a child actually starts with: the prompt default, looked up on `env` itself (see above),
 * then without git's repository-locating variables (`child-env.ts`). `cwd` is how refs names the
 * repository, and an inherited `GIT_DIR` would silently override it. */
const spawnEnv = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): NodeJS.ProcessEnv =>
  withoutRepositoryLocal(childEnv(env), platform);

export { TERMINAL_PROMPT_VARIABLE, childEnv, spawnEnv };
