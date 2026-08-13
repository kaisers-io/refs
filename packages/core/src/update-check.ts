import { PLAIN_VERSION_PATTERN, comparePlainVersions } from './version.ts';
import { readFile, stat } from 'node:fs/promises';
import type { Fetcher } from './npm-resolver.ts';
import type { RefsHome } from './home.ts';
import type { Updates } from './schemas/config.ts';
import { writeFileAtomic } from './fs-atomic.ts';
import { z } from 'zod';

// Learns the version npm currently publishes as `latest`, so a command can mention that the running
// CLI is behind. Everything here is best-effort by construction: no result, a timeout, a malformed
// body or an unwritable cache all mean "we don't know", never an error the caller has to handle.
//
// The registry host is hardcoded. Reading it from npm configuration would let an environment
// variable decide who gets to say what "current" is, and the question being asked is specifically
// about the canonical public publication.
const REGISTRY_LATEST_URL = 'https://registry.npmjs.org/@kaisers-io%2Frefs/latest';

// One request per day per installation. Short enough to find a release while it still matters, long
// enough that the network is not a routine part of using refs.
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const CACHE_TTL_MS = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

const REQUEST_TIMEOUT_MS = 2000;

const HTTP_OK = 200;

const JSON_INDENT = 2;

// The response is untrusted input: only a plain `x.y.z` is accepted, and nothing else from the body
// is ever read or shown. A registry that answered with prose would otherwise get to put text in
// front of the user.
const zLatestResponse = z.looseObject({
  version: z.string().regex(PLAIN_VERSION_PATTERN),
});

const zUpdateCache = z.strictObject({
  checked_at: z.iso.datetime(),
  latest_version: z.string().regex(PLAIN_VERSION_PATTERN),
});

type UpdateCache = z.infer<typeof zUpdateCache>;

/** Reads the cache, treating every failure — absent, unreadable, malformed, written by a version
 * that shaped it differently — as "nothing cached". A discardable cache is never worth an error. */
const readUpdateCache = async (home: RefsHome): Promise<UpdateCache | undefined> => {
  try {
    const parsed = zUpdateCache.safeParse(JSON.parse(await readFile(home.updateCachePath, 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/** Writes the cache, and only inside a refs home that already exists — the `stat` is the guard, not
 * a formality: `writeFileAtomic` creates parent directories, and `refs doctor` runs before
 * `refs init` on a fresh machine. Reporting on a home is not permission to create one. Its
 * rejection lands in the same catch as an unwritable disk, which is the right outcome for both. */
const writeUpdateCache = async (home: RefsHome, cache: UpdateCache): Promise<void> => {
  try {
    await stat(home.root);
    await writeFileAtomic(
      home.updateCachePath,
      `${JSON.stringify(cache, undefined, JSON_INDENT)}\n`,
    );
  } catch {
    // A cache we cannot write costs one network request next time, and nothing else.
  }
};

/** A cache is fresh only within the ttl AND not dated in the future. Without the lower bound a
 * stamp ahead of the clock — a hand-edited file, a machine whose time was corrected backwards —
 * reads as fresh until real time catches up, which silently disables the check for as long as the
 * skew lasts and leaves doctor reporting an answer nobody can refresh. NaN from an unparseable
 * date fails both comparisons, which is the right outcome too. */
const isFresh = (cache: UpdateCache, nowMs: number): boolean => {
  const ageMs = nowMs - Date.parse(cache.checked_at);
  return ageMs >= 0 && ageMs < CACHE_TTL_MS;
};

/** Asks the registry for the `latest` dist-tag. `undefined` on any failure — including a body that
 * does not carry a plain version, which a prerelease `latest` would produce. */
const fetchLatestVersion = async (fetch: Fetcher): Promise<string | undefined> => {
  try {
    const response = await fetch(REGISTRY_LATEST_URL, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status !== HTTP_OK) {
      return undefined;
    }
    const parsed = zLatestResponse.safeParse(await response.json());
    return parsed.success ? parsed.data.version : undefined;
  } catch {
    return undefined;
  }
};

type RefreshArgs = {
  fetch: Fetcher;
  home: RefsHome;
  nowMs: number;
};

type LatestResult = {
  latest: string | undefined;
  /** This invocation went to the network and got an answer. Only such a run announces anything —
   * that, and nothing recorded about notices, is what limits a routine notice to once a day. */
  refreshed: boolean;
  /** `latest` is the last thing npm said, not what it says now: the cache had expired and the
   * refresh failed. A caller that reports the value must say so, because "0.9.0 is the latest" and
   * "0.9.0 was the latest when we last managed to ask" are different claims. */
  stale: boolean;
};

/** Returns the known `latest`, refreshing it from the registry when the cache is stale or absent. */
const loadLatestVersion = async (args: RefreshArgs): Promise<LatestResult> => {
  const cached = await readUpdateCache(args.home);
  if (cached !== undefined && isFresh(cached, args.nowMs)) {
    return { latest: cached.latest_version, refreshed: false, stale: false };
  }
  const latest = await fetchLatestVersion(args.fetch);
  if (latest === undefined) {
    // Deliberately does not touch the cache: a failed request must not push the next attempt out by
    // another day, and must not overwrite a usable older answer.
    return { latest: cached?.latest_version, refreshed: false, stale: true };
  }
  await writeUpdateCache(args.home, {
    checked_at: new Date(args.nowMs).toISOString(),
    latest_version: latest,
  });
  return { latest, refreshed: true, stale: false };
};

/** `true` when `latest` is a version this CLI does not have. An unorderable pair (either side not
 * plain `x.y.z`) is not an update — saying "newer" of a version we cannot order would be a guess. */
const isBehind = (current: string, latest: string): boolean => {
  const compared = comparePlainVersions(current, latest);
  return compared !== undefined && compared < 0;
};

const UPDATE_COMMAND = 'npm i -g @kaisers-io/refs@latest';

const updateMessage = (current: string, latest: string): string =>
  `refs ${latest} is available (this is ${current}) — update: ${UPDATE_COMMAND}`;

// Only `0` forces the check off and only `1` forces it on; anything else (including a typo) falls
// through to the config value, so a mistyped variable cannot silently disable the check.
const forcedByEnv = (env: NodeJS.ProcessEnv): boolean | undefined => {
  const raw = env['REFS_UPDATE_CHECK']?.trim();
  if (raw === '0') {
    return false;
  }
  if (raw === '1') {
    return true;
  }
  return undefined;
};

// `CI=false` is common enough that truthiness is the wrong test.
const isCi = (env: NodeJS.ProcessEnv): boolean => {
  const raw = env['CI']?.trim().toLowerCase();
  return raw !== undefined && raw !== '' && raw !== 'false' && raw !== '0';
};

// `updates` is optional in the config and stays optional here rather than being filled in by the
// caller: absent means the defaults, and only this module should know what those are.
const UPDATES_DEFAULTS: Updates = { check: true, notify: true };

type PolicyArgs = {
  env: NodeJS.ProcessEnv;
  updates: Updates | undefined;
};

/** Why the check will or will not run. A boolean would be enough to decide, but not enough to
 * explain: `refs doctor` has to tell the user which of three different reasons applies, and
 * "remove [updates].check=false" is wrong advice on a CI machine with a default config. */
type CheckDecision = 'ci' | 'config' | 'env' | 'on';

const updateCheckDecision = (args: PolicyArgs): CheckDecision => {
  const forced = forcedByEnv(args.env);
  if (forced !== undefined) {
    return forced ? 'on' : 'env';
  }
  if (!(args.updates ?? UPDATES_DEFAULTS).check) {
    return 'config';
  }
  return isCi(args.env) ? 'ci' : 'on';
};

/** Whether to contact the registry at all: `REFS_UPDATE_CHECK` wins, then `[updates].check`, then
 * on everywhere except CI — where the answer helps nobody and costs every job a request. */
const shouldCheck = (args: PolicyArgs): boolean => updateCheckDecision(args) === 'on';

/** Whether a routine command may mention it. `refs doctor` ignores this: asking for a health report
 * is asking. */
const shouldNotify = (args: PolicyArgs): boolean =>
  shouldCheck(args) && (args.updates ?? UPDATES_DEFAULTS).notify;

export {
  CACHE_TTL_MS,
  updateCheckDecision,
  isBehind,
  loadLatestVersion,
  readUpdateCache,
  REGISTRY_LATEST_URL,
  shouldCheck,
  shouldNotify,
  updateMessage,
  writeUpdateCache,
};
export type { CheckDecision, LatestResult, UpdateCache };
