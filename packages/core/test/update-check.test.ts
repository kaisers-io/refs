import {
  CACHE_TTL_MS,
  isBehind,
  loadLatestVersion,
  shouldCheck,
  shouldNotify,
} from '../src/update-check.ts';
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Fetcher } from '../src/npm-resolver.ts';
import { join } from 'node:path';
import { resolveHome } from '../src/home.ts';
import { tmpdir } from 'node:os';
import { zUpdates } from '../src/schemas/config.ts';

// The update check is best-effort by construction: every failure path must degrade to "we don't
// know" rather than to an error a caller has to handle, and a failed attempt must never look like a
// successful one. That is most of what is asserted here.

const NOW_MS = Date.parse('2026-08-13T12:00:00.000Z');
const ONE_SECOND_MS = 1000;
const HTTP_NOT_FOUND = 404;
const HTTP_OK = 200;
const LATEST = '0.9.0';

const withTempHome = async (body: (homeDir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-update-'));
  try {
    await body(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
};

const respondingWith =
  (body: unknown, status = HTTP_OK): Fetcher =>
  () =>
    Promise.resolve({ json: () => Promise.resolve(body), status });

const failingFetcher: Fetcher = () => Promise.reject(new Error('offline'));

const defaults = zUpdates.parse({});

describe('update cache: refreshing', () => {
  it('fetches and caches when nothing is cached yet', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const home = resolveHome({ REFS_HOME: homeDir });

      const result = await loadLatestVersion({
        fetch: respondingWith({ version: LATEST }),
        home,
        nowMs: NOW_MS,
      });

      expect(result).toStrictEqual({ latest: LATEST, refreshed: true, stale: false });
      const written: unknown = JSON.parse(await readFile(home.updateCachePath, 'utf8'));
      expect(written).toStrictEqual({
        checked_at: new Date(NOW_MS).toISOString(),
        latest_version: LATEST,
      });
    });
  });

  it('reads a fresh cache without going to the network', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const home = resolveHome({ REFS_HOME: homeDir });
      await mkdir(home.cacheDir, { recursive: true });
      await writeFile(
        home.updateCachePath,
        JSON.stringify({ checked_at: new Date(NOW_MS).toISOString(), latest_version: LATEST }),
      );

      const result = await loadLatestVersion({
        fetch: failingFetcher,
        home,
        nowMs: NOW_MS + ONE_SECOND_MS,
      });

      // `refreshed: false` is what keeps a routine notice to once a day: only the invocation that
      // actually refreshed announces anything. Not stale: the cache is inside its ttl.
      expect(result).toStrictEqual({ latest: LATEST, refreshed: false, stale: false });
    });
  });
});

describe('update cache: ttl', () => {
  it('refetches once the cache is older than the ttl', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const home = resolveHome({ REFS_HOME: homeDir });
      await mkdir(home.cacheDir, { recursive: true });
      await writeFile(
        home.updateCachePath,
        JSON.stringify({
          checked_at: new Date(NOW_MS - CACHE_TTL_MS - 1).toISOString(),
          latest_version: '0.8.0',
        }),
      );

      const result = await loadLatestVersion({
        fetch: respondingWith({ version: LATEST }),
        home,
        nowMs: NOW_MS,
      });

      expect(result).toStrictEqual({ latest: LATEST, refreshed: true, stale: false });
    });
  });
});

describe('update cache: failure paths', () => {
  it('keeps a stale answer and does not rewrite the cache when the request fails', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const home = resolveHome({ REFS_HOME: homeDir });
      await mkdir(home.cacheDir, { recursive: true });
      const staleAt = new Date(NOW_MS - CACHE_TTL_MS - 1).toISOString();
      await writeFile(
        home.updateCachePath,
        JSON.stringify({ checked_at: staleAt, latest_version: '0.8.0' }),
      );

      const result = await loadLatestVersion({ fetch: failingFetcher, home, nowMs: NOW_MS });

      // A failed request must not push the next attempt out by another day, so the timestamp is
      // untouched — and the older answer is still better than none, as long as whoever reports it
      // is told it is old.
      expect(result).toStrictEqual({ latest: '0.8.0', refreshed: false, stale: true });
      const written = JSON.parse(await readFile(home.updateCachePath, 'utf8')) as {
        checked_at: string;
      };
      expect(written.checked_at).toBe(staleAt);
    });
  });

  it('treats a non-200, a malformed body and a non-plain version alike', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const home = resolveHome({ REFS_HOME: homeDir });
      const args = { home, nowMs: NOW_MS };

      const notFound = await loadLatestVersion({
        ...args,
        fetch: respondingWith({}, HTTP_NOT_FOUND),
      });
      const noVersion = await loadLatestVersion({ ...args, fetch: respondingWith({ nope: 1 }) });
      // A prerelease published as `latest` is not something this can order, so it is not an answer.
      const prerelease = await loadLatestVersion({
        ...args,
        fetch: respondingWith({ version: '1.0.0-rc.1' }),
      });

      expect(notFound).toStrictEqual({ latest: undefined, refreshed: false, stale: true });
      expect(noVersion).toStrictEqual({ latest: undefined, refreshed: false, stale: true });
      expect(prerelease).toStrictEqual({ latest: undefined, refreshed: false, stale: true });
    });
  });
});

describe('update cache: where it may write', () => {
  it('does not create the refs home just to cache an answer', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      // `refs doctor` runs before `refs init` on a fresh machine. Reporting on a home is not
      // permission to create one.
      const home = resolveHome({ REFS_HOME: join(homeDir, 'not-created-yet') });

      const result = await loadLatestVersion({
        fetch: respondingWith({ version: LATEST }),
        home,
        nowMs: NOW_MS,
      });

      expect(result).toStrictEqual({ latest: LATEST, refreshed: true, stale: false });
      await expect(readFile(home.updateCachePath, 'utf8')).rejects.toThrow(/ENOENT/u);
    });
  });
});

describe('behind detection', () => {
  it('is true only for a version this CLI does not have', () => {
    expect.hasAssertions();
    expect(isBehind('0.8.3', '0.9.0')).toBe(true);
    expect(isBehind('0.9.0', '0.9.0')).toBe(false);
    expect(isBehind('1.0.0', '0.9.0')).toBe(false);
  });

  it('is false when the pair cannot be ordered', () => {
    expect.hasAssertions();
    // Calling a version we cannot order "newer" would be a guess presented as news.
    expect(isBehind('0.9.0-rc.1', '0.9.0')).toBe(false);
  });
});

describe('check and notify policy', () => {
  it('is on by default and off in CI', () => {
    expect.hasAssertions();
    expect(shouldCheck({ env: {}, updates: defaults })).toBe(true);
    expect(shouldCheck({ env: { CI: 'true' }, updates: defaults })).toBe(false);
  });

  it('does not read CI=false as being in CI', () => {
    expect.hasAssertions();
    expect(shouldCheck({ env: { CI: 'false' }, updates: defaults })).toBe(true);
    expect(shouldCheck({ env: { CI: '0' }, updates: defaults })).toBe(true);
    expect(shouldCheck({ env: { CI: '' }, updates: defaults })).toBe(true);
  });

  it('lets the environment override the config in both directions', () => {
    expect.hasAssertions();
    const off = zUpdates.parse({ check: false });
    expect(shouldCheck({ env: { REFS_UPDATE_CHECK: '1' }, updates: off })).toBe(true);
    expect(shouldCheck({ env: { CI: 'true', REFS_UPDATE_CHECK: '1' }, updates: defaults })).toBe(
      true,
    );
    expect(shouldCheck({ env: { REFS_UPDATE_CHECK: '0' }, updates: defaults })).toBe(false);
  });

  it('ignores a value it does not recognise rather than guessing', () => {
    expect.hasAssertions();
    // A typo must not silently disable the check.
    expect(shouldCheck({ env: { REFS_UPDATE_CHECK: 'yes' }, updates: defaults })).toBe(true);
    expect(shouldCheck({ env: { REFS_UPDATE_CHECK: 'off' }, updates: defaults })).toBe(true);
  });

  it('separates not asking from not mentioning', () => {
    expect.hasAssertions();
    const quiet = zUpdates.parse({ notify: false });
    // notify=false still checks: `refs doctor` answers, routine commands stay silent.
    expect(shouldCheck({ env: {}, updates: quiet })).toBe(true);
    expect(shouldNotify({ env: {}, updates: quiet })).toBe(false);
    // check=false implies nothing to notify about.
    expect(shouldNotify({ env: {}, updates: zUpdates.parse({ check: false }) })).toBe(false);
  });
});
