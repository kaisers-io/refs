// Shared ref-state logic: `refs list`'s staleness marker (`list.ts`) and `refs sync
// --stale-only`'s pre-sync filter (`sync.ts`) both need the exact same "is this ref due for a
// re-fetch" rule, so it lives here rather than one command importing the other. The human-facing
// rendering of that same state (`synced:` / `status:` / `missing:`) lives here too, shared by
// `list`, `show` and `resolve` — one place for the rule that `status: stale` is redundant once
// `synced: never` already says it.

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_YEAR = 365;

const MISSING_LINE = 'missing: checkout not found — run: refs sync';
const NEVER = 'never';

/** Whether a ref's last fetch is stale relative to `ttlMs`: always stale when it has never been
 * fetched (`lastFetchedAt` undefined), otherwise stale once `now` is more than `ttlMs` past it. */
const isStale = (lastFetchedAt: string | undefined, ttlMs: number, now: number): boolean => {
  if (lastFetchedAt === undefined) {
    return true;
  }
  return now - Date.parse(lastFetchedAt) > ttlMs;
};

// `1 minute ago` / `2 minutes ago` — the unit is singular only at exactly 1.
const plural = (count: number, unit: string): string =>
  `${count} ${unit}${count === 1 ? '' : 's'} ago`;

/** Renders how long ago a ref was last fetched, in the largest unit that still yields a whole
 * number, always rounding DOWN (119 minutes is `1 hour ago`, not `2 hours ago`).
 *
 * Two inputs are deliberately flattened to a non-numeric answer rather than a misleading one: a
 * missing timestamp is `never`, and so is an unparseable one — the state file is zod-validated
 * (`z.iso.datetime()`), so a `NaN` here means the file was tampered with, and `NaN years ago`
 * would be worse than admitting we don't know. A timestamp in the FUTURE (clock skew between
 * writing and reading the state) clamps to `just now` instead of rendering a negative duration. */
// eslint-disable-next-line max-statements -- each `if` is one more unit in the rounding cascade (minute, hour, day, year); splitting it into helpers would scatter the single rule documented above.
const formatSince = (lastFetchedAt: string | undefined, now: number): string => {
  if (lastFetchedAt === undefined) {
    return NEVER;
  }
  const elapsedMs = now - Date.parse(lastFetchedAt);
  if (Number.isNaN(elapsedMs)) {
    return NEVER;
  }
  const seconds = Math.floor(elapsedMs / MS_PER_SECOND);
  if (seconds < SECONDS_PER_MINUTE) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) {
    return plural(minutes, 'minute');
  }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) {
    return plural(hours, 'hour');
  }
  const days = Math.floor(hours / HOURS_PER_DAY);
  if (days < DAYS_PER_YEAR) {
    return plural(days, 'day');
  }
  return plural(Math.floor(days / DAYS_PER_YEAR), 'year');
};

type StatusArgs = {
  lastFetchedAt: string | undefined;
  missing: boolean;
  now: number;
  stale: boolean;
};

/** The `synced:` / `status:` / `missing:` block shared by `list`, `show` and `resolve`.
 *
 * `synced` always prints; the other two only when they apply. `status: stale` is suppressed
 * whenever `synced` came out as `never` — `isStale` is unconditionally `true` for a ref that was
 * never fetched, so the line would only repeat what `never` already said. The suppression keys
 * off `formatSince`'s ANSWER rather than off `lastFetchedAt` being undefined, so an unparseable
 * timestamp (which also renders as `never`) cannot produce the contradictory pair
 * `synced: never` + `status: stale`.
 *
 * `status` and `missing` stay separate keys because they answer different questions: freshness
 * versus existence. A ref can be missing without being stale (the directory was deleted after the
 * last fetch) and stale without being missing. */
const statusLines = (args: StatusArgs): string[] => {
  const since = formatSince(args.lastFetchedAt, args.now);
  const lines = [`synced: ${since}`];
  if (args.stale && since !== NEVER) {
    lines.push('status: stale');
  }
  if (args.missing) {
    lines.push(MISSING_LINE);
  }
  return lines;
};

export { formatSince, isStale, statusLines };
