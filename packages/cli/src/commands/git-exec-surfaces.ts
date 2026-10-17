// What in a git configuration can make refs' own git invocations run a command — the reading
// behind `doctor`'s `git-exec-surfaces` check and the warning `add` gives before it clones.
//
// The listing this reads comes from a git process refs started, so it already carries refs'
// execution policy (core's `git-exec-policy.ts`) as `command`-scope entries, listed last. That is
// the point: what is reported is what refs' invocations inherit, not the user's raw files.
//
// - `core.fsmonitor`: refs empties it on every invocation, and the last value wins, so it is
//   reported only when nothing overrode it.
// - Configured hooks: refs disables every event it causes with `hook.<event>.enabled=false`, an
//   event-level switch git honours from 2.55 unless a hook label shares the event's name, and
//   from 2.54 also adds `hook.<label>.enabled=false` for each label in the configuration graph
//   (`git-hook-labels.ts`). Those arrive in this listing as command-scope entries, and the label
//   check below honours them, so a hook is reported only if no such entry disabled it. Before
//   2.54 git has no configured hooks and ignores the keys. A version that cannot be read counts
//   as one with configured hooks: a failure to look is not evidence that nothing runs.
// - Filters: never overridden, because turning one off changes what a checkout contains (#187).
//
// Presence, not safety: an earlier version reported only commands that looked
// repository-relative, which was measured to be unsound in both directions — `/bin/sh ./evil.sh`
// has an absolute first token and runs the checkout's script anyway. Presence is decidable.

const NOT_FOUND = -1;
// One entry is two NUL-separated fields: the scope, then `<key>\n<value>`.
const FIELDS_PER_ENTRY = 2;

// A subsection name may itself contain dots — `[hook "company.checkout"]` is valid — so the
// subsection is everything between the section and the final property. A narrower `[^.]+` missed
// exactly that shape, which was measured to run.
const HOOK_COMMAND = /^hook\.(?<label>.+)\.command$/u;
const HOOK_ENABLED = /^hook\.(?<label>.+)\.enabled$/u;
const FILTER_COMMAND = /^filter\..+\.(?:clean|smudge|process)$/u;
const FSMONITOR = 'core.fsmonitor';
const FSMONITOR_KEY = /^core\.fsmonitor$/u;
const GIT_VERSION = /^git version (?<major>\d+)\.(?<minor>\d+)/u;

// The first git release with configured hooks.
const FIRST_WITH_HOOKS = { major: 2, minor: 54 } as const;

// `core.fsmonitor` takes a boolean OR a command, and git runs the command form with its working
// directory set to the worktree. Only the command form is an execution surface.
const FSMONITOR_BOOLEAN = new Set(['', '0', '1', 'false', 'no', 'off', 'on', 'true', 'yes']);

type ConfigEntry = { key: string; scope: string; value: string };

/** `git config --list -z --show-scope` records: `<scope>\0<key>\n<value>\0`, so the NUL-separated
 * fields alternate between a scope and a key/value pair.
 *
 * `-z` is not optional. A configured hook's value is a command line, and a command line can carry
 * a newline — which a line-oriented parse would turn into a second, bogus key. `--show-scope` is
 * how `local` is excluded without depending on where this ran: `--global --system` together is not
 * something git accepts (`error: only one config file at a time`), and `--system` alone fails
 * outright on a machine with no `/etc/gitconfig`. Both measured. */
const parseScopedConfig = (stdout: string): ConfigEntry[] => {
  const fields = stdout.split('\0');
  const entries: ConfigEntry[] = [];
  for (let index = 0; index + 1 < fields.length; index += FIELDS_PER_ENTRY) {
    /* v8 ignore next 2 -- the loop guard already proves both indices are in range; the fallbacks
       exist only because `noUncheckedIndexedAccess` cannot see that. */
    const record = fields[index + 1] ?? '';
    const scope = fields[index] ?? '';
    // A record with no newline is a key git wrote with no value — `[core]` then a bare `bare`.
    const at = record.indexOf('\n');
    const key = at === NOT_FOUND ? record : record.slice(0, at);
    const value = at === NOT_FOUND ? '' : record.slice(at + 1);
    entries.push({ key, scope, value });
  }
  return entries;
};

/** Hook labels git will not run. A later value wins, so the last `enabled` for a label decides. */
const disabledHooks = (entries: readonly ConfigEntry[]): Set<string> => {
  const enabled = new Map<string, boolean>();
  for (const entry of entries) {
    const label = HOOK_ENABLED.exec(entry.key)?.groups?.['label'];
    if (label !== undefined) {
      enabled.set(label, entry.value !== 'false');
    }
  }
  return new Set([...enabled].filter(([, isOn]) => !isOn).map(([label]) => label));
};

/** Whether a configured hook can fire under refs' policy on the git that printed `versionLine`. */
const configuredHooksCanRun = (versionLine: string | undefined): boolean => {
  const groups = GIT_VERSION.exec(versionLine?.trim() ?? '')?.groups;
  if (groups === undefined) {
    return true;
  }
  const major = Number(groups['major']);
  return (
    major > FIRST_WITH_HOOKS.major ||
    (major === FIRST_WITH_HOOKS.major && Number(groups['minor']) >= FIRST_WITH_HOOKS.minor)
  );
};

/** Whether the `core.fsmonitor` git uses — the LAST one listed — is a command. */
const fsmonitorIsCommand = (entries: readonly ConfigEntry[]): boolean => {
  const value = entries.findLast((entry) => entry.key === FSMONITOR)?.value;
  return value !== undefined && !FSMONITOR_BOOLEAN.has(value.trim().toLowerCase());
};

type Judge = { disabled: ReadonlySet<string>; hooksRun: boolean };

const isHookOrFilterSurface = (entry: ConfigEntry, judge: Judge): boolean => {
  const label = HOOK_COMMAND.exec(entry.key)?.groups?.['label'];
  if (label !== undefined) {
    return judge.hooksRun && !judge.disabled.has(label);
  }
  return FILTER_COMMAND.test(entry.key);
};

/** The configuration keys that can make refs' git invocations run a command, deduplicated.
 *
 * A checkout's own `.git/config` is excluded: refs clones the repository itself, a tracked
 * repository cannot write there, and refs pins `core.hooksPath` in exactly that file. */
const surfaceKeys = (stdout: string, versionLine: string | undefined): string[] => {
  const entries = parseScopedConfig(stdout).filter((entry) => entry.scope !== 'local');
  const judge: Judge = {
    disabled: disabledHooks(entries),
    hooksRun: configuredHooksCanRun(versionLine),
  };
  const keys = entries
    .filter((entry) => isHookOrFilterSurface(entry, judge))
    .map((entry) => entry.key);
  if (fsmonitorIsCommand(entries)) {
    keys.push(FSMONITOR);
  }
  return [...new Set(keys)];
};

const REASONS: readonly (readonly [RegExp, string])[] = [
  [
    FILTER_COMMAND,
    "a filter is selected by a checkout's own .gitattributes and stays enabled, because turning " +
      'it off would change what the checkout contains',
  ],
  [
    HOOK_COMMAND,
    'a configured hook fires on the events refs causes and nothing disabled it: refs switches ' +
      'those events off and disables each label it finds',
  ],
  [FSMONITOR_KEY, 'fsmonitor runs a command in the worktree'],
];

/** Why each kind of key found is still live, for the kinds present only. */
const surfaceDetail = (keys: readonly string[]): string => {
  const reasons = REASONS.filter(([pattern]) => keys.some((key) => pattern.test(key))).map(
    ([, reason]) => reason,
  );
  return (
    `${keys.join(', ')}: git runs these itself and the managed hooks path does not cover them — ` +
    `${reasons.join('; ')}. Whether one of them reaches a checkout's content depends on the ` +
    'command, which refs cannot decide for you'
  );
};

export { surfaceDetail, surfaceKeys };
