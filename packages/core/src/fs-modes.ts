// The access modes refs sets on everything it owns, instead of leaving them to whatever umask the
// invoking process happened to carry.
//
// Measured on this host: `refs init` under `umask 002` produced `drwxrwxr-x` on the hooks
// directory, and under `umask 000`, `drwxrwxrwx`. That directory is the one every managed checkout
// points `core.hooksPath` at, and git resolves hook NAMES against it — so a second local principal
// able to write there gets code executed as the refs user, with refs' environment, during an
// ordinary `refs sync`. Under the default `umask 022` it is not writable by anyone else and the
// question does not arise, which is exactly the problem: refs neither chose nor recorded which of
// those it got.
//
// `mkdir`/`writeFile` modes are themselves masked by the umask, but `0o700` and `0o600` survive
// every umask that leaves the owner any access at all.

/** Directories refs owns: nobody but the owner may read, write or traverse them. */
const DIR_MODE = 0o700;

/** Files refs writes: `config.toml` may hold a credential-bearing url from `--proposal` or a hand
 * edit, and `state.json` records where every checkout is. Neither is anyone else's business. */
const FILE_MODE = 0o600;

export { DIR_MODE, FILE_MODE };
