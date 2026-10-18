// The one git release line refs refuses to run.
//
// Git 2.54 introduced configured hooks (`[hook "<label>"] event = …; command = …`) but not the
// event-level switch refs uses to turn them off (`hook.<event>.enabled`, git 2.55). On 2.54.x a
// configured hook can only be disabled by its label, and refs cannot know every label in advance:
// an `includeIf "hasconfig:remote.*.url:…"` section is evaluated against the repository being
// cloned, so a listing taken before the clone does not show it. Rather than run with a known gap,
// refs refuses that release line and says what to install. 2.53 and older have no configured
// hooks; 2.55 and newer have the switch.

// Exit code of a git command refs refused to start; the reason is in `stderr`.
const REFUSED_EXIT_CODE = 1;

const REFUSED_GIT = /^git version 2\.54(?:\.|$)/u;

const GIT_2_54_REFUSAL =
  'refs does not run git 2.54.x: that release can run configured hooks ([hook "<name>"] in your ' +
  'git configuration) without a way for refs to switch them off, and refs never runs code from or ' +
  'for a checkout. Install git 2.55 or newer (or stay on 2.53)';

/** The refusal for the installed git, from `git --version` output; `undefined` when allowed. */
const gitVersionRefusal = (versionOutput: string): string | undefined =>
  REFUSED_GIT.test(versionOutput.trim()) ? GIT_2_54_REFUSAL : undefined;

/** Whether `args` is the version probe itself, which the gate must not wait on. */
const isVersionProbe = (args: readonly string[]): boolean =>
  args.length === 1 && args[0] === '--version';

export { GIT_2_54_REFUSAL, REFUSED_EXIT_CODE, gitVersionRefusal, isVersionProbe };
