import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../src/npm-resolver.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { resolveNpmPackage } from '../src/npm-resolver.ts';

const HTTP_STATUS_OK = 200;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_SERVER_ERROR = 500;

const fetcherWithStatus =
  (status: number): Fetcher =>
  () =>
    Promise.resolve({ json: () => Promise.resolve({}), status });

const fetcherWithBody =
  (body: unknown): Fetcher =>
  () =>
    Promise.resolve({ json: () => Promise.resolve(body), status: HTTP_STATUS_OK });

const unfetchedFetcher = (): { fetcher: Fetcher; isFetched: () => boolean } => {
  let fetched = false;
  const fetcher: Fetcher = () => {
    fetched = true;
    return Promise.resolve({ json: () => Promise.resolve({}), status: HTTP_STATUS_OK });
  };
  return { fetcher, isFetched: () => fetched };
};

const NEXT_REPO_URL = 'git+https://github.com/vercel/next.js.git';
const LONG_NAME_LENGTH = 215;

describe('repository resolution', () => {
  it('(a) resolves object repository with git+https url and directory', async () => {
    expect.hasAssertions();
    const fetcher = fetcherWithBody({
      repository: { directory: 'packages/core', url: NEXT_REPO_URL },
    });
    const result = await resolveNpmPackage(fetcher, 'next');
    expect(result).toStrictEqual({
      cloneUrl: 'https://github.com/vercel/next.js.git',
      directory: 'packages/core',
      key: 'github.com/vercel/next.js',
    });
  });

  it('omits directory when repository has only a url', async () => {
    expect.hasAssertions();
    const fetcher = fetcherWithBody({ repository: { url: NEXT_REPO_URL } });
    const result = await resolveNpmPackage(fetcher, 'next');
    expect(result).toStrictEqual({
      cloneUrl: 'https://github.com/vercel/next.js.git',
      key: 'github.com/vercel/next.js',
    });
  });

  it('ignores an empty directory string', async () => {
    expect.hasAssertions();
    const fetcher = fetcherWithBody({ repository: { directory: '', url: NEXT_REPO_URL } });
    const result = await resolveNpmPackage(fetcher, 'next');
    expect(result.directory).toBeUndefined();
  });
});

describe('repository fallback contract', () => {
  const FALLBACK = /has no usable repository field — find the repository and run: refs add/u;

  it('(b) rejects string shorthand github: with the fallback text', async () => {
    expect.hasAssertions();
    const fetcher = fetcherWithBody({ repository: 'github:vercel/next.js' });
    await expect(resolveNpmPackage(fetcher, 'next')).rejects.toThrow(FALLBACK);
  });

  it('(d) rejects a missing repository field with the fallback text', async () => {
    expect.hasAssertions();
    const fetcher = fetcherWithBody({});
    await expect(resolveNpmPackage(fetcher, 'pkg')).rejects.toThrow(FALLBACK);
  });

  it('rejects a repository object without url with the fallback text', async () => {
    expect.hasAssertions();
    const fetcher = fetcherWithBody({ repository: {} });
    await expect(resolveNpmPackage(fetcher, 'pkg')).rejects.toThrow(FALLBACK);
  });
});

describe('registry http handling', () => {
  it('(c) maps 404 to not found', async () => {
    expect.hasAssertions();
    const fetcher = fetcherWithStatus(HTTP_STATUS_NOT_FOUND);
    await expect(resolveNpmPackage(fetcher, 'nonexistent')).rejects.toThrow(
      /npm package 'nonexistent' not found/u,
    );
  });

  it('(g) maps other non-200 statuses to validation errors naming the status', async () => {
    expect.hasAssertions();
    const fetcher = fetcherWithStatus(HTTP_STATUS_SERVER_ERROR);
    await expect(resolveNpmPackage(fetcher, 'pkg')).rejects.toThrow(/status 500/u);
  });

  it('(e) encodes only the inner slash of a scoped name in the registry url', async () => {
    expect.hasAssertions();
    let capturedUrl = '';
    const fetcher: Fetcher = (url: string) => {
      capturedUrl = url;
      return fetcherWithBody({ repository: { url: NEXT_REPO_URL } })(url);
    };
    await resolveNpmPackage(fetcher, '@scope/pkg');
    expect(capturedUrl).toBe('https://registry.npmjs.org/@scope%2Fpkg');
  });
});

describe('package name validation', () => {
  it('(f) rejects invalid names with a usage error before fetching', async () => {
    expect.hasAssertions();
    let fetcherCalled = false;
    const fetcher: Fetcher = () => {
      fetcherCalled = true;
      return Promise.resolve({ json: () => Promise.resolve({}), status: HTTP_STATUS_OK });
    };
    await expect(resolveNpmPackage(fetcher, '')).rejects.toThrow(/invalid package name/u);
    await expect(resolveNpmPackage(fetcher, '.pkg')).rejects.toThrow(/invalid package name/u);
    await expect(resolveNpmPackage(fetcher, '_pkg')).rejects.toThrow(/invalid package name/u);
    await expect(resolveNpmPackage(fetcher, 'MyPkg')).rejects.toThrow(/invalid package name/u);
    expect(fetcherCalled).toBe(false);
  });

  it.each(['pkg', 'my-pkg', 'my_pkg', 'pkg-1', '@scope/pkg'])(
    'accepts valid name %s',
    async (name) => {
      expect.hasAssertions();
      const fetcher = fetcherWithBody({ repository: { url: NEXT_REPO_URL } });
      await expect(resolveNpmPackage(fetcher, name)).resolves.toBeDefined();
    },
  );

  it('rejects names exceeding 214 characters without fetching', async () => {
    expect.hasAssertions();
    const { fetcher, isFetched } = unfetchedFetcher();
    const longName = 'a'.repeat(LONG_NAME_LENGTH);
    await expect(resolveNpmPackage(fetcher, longName)).rejects.toThrow(/exceeds maximum length/u);
    expect(isFetched()).toBe(false);
  });

  it('rejects reserved name node_modules without fetching', async () => {
    expect.hasAssertions();
    const { fetcher, isFetched } = unfetchedFetcher();
    await expect(resolveNpmPackage(fetcher, 'node_modules')).rejects.toThrow(/reserved name/u);
    expect(isFetched()).toBe(false);
  });

  it('rejects reserved name favicon.ico without fetching', async () => {
    expect.hasAssertions();
    const { fetcher, isFetched } = unfetchedFetcher();
    await expect(resolveNpmPackage(fetcher, 'favicon.ico')).rejects.toThrow(/reserved name/u);
    expect(isFetched()).toBe(false);
  });
});

describe('directory validation', () => {
  it('drops traversal directory ../../..', async () => {
    expect.hasAssertions();
    const fetcher = fetcherWithBody({
      repository: { directory: '../../..', url: NEXT_REPO_URL },
    });
    const result = await resolveNpmPackage(fetcher, 'next');
    expect(result.directory).toBeUndefined();
  });

  it('drops absolute directory /abs', async () => {
    expect.hasAssertions();
    const fetcher = fetcherWithBody({
      repository: { directory: '/abs', url: NEXT_REPO_URL },
    });
    const result = await resolveNpmPackage(fetcher, 'next');
    expect(result.directory).toBeUndefined();
  });

  it('passes through valid directory packages/next', async () => {
    expect.hasAssertions();
    const fetcher = fetcherWithBody({
      repository: { directory: 'packages/next', url: NEXT_REPO_URL },
    });
    const result = await resolveNpmPackage(fetcher, 'next');
    expect(result.directory).toBe('packages/next');
  });
});

describe('json parsing', () => {
  it('throws validationError when json() rejects with SyntaxError', async () => {
    expect.hasAssertions();
    const fetcher: Fetcher = () =>
      Promise.resolve({
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
        status: HTTP_STATUS_OK,
      });
    await expect(resolveNpmPackage(fetcher, 'pkg')).rejects.toThrow(/not parseable JSON/u);
  });
});

describe('packument shape validation', () => {
  it('rejects a non-object registry body with an actionable validation error', async () => {
    expect.hasAssertions();
    const fetcher = fetcherWithBody('not a packument');
    await expect(resolveNpmPackage(fetcher, 'next')).rejects.toThrow(
      "invalid npm package response for 'next'",
    );
  });
});

// The registry request encodes a scoped name's single slash (`@scope/pkg` → `@scope%2Fpkg`). What
// makes that encoding complete is `validatePackageName` running first — its pattern admits at most
// that one slash. These cases pin the property that is observable from outside, namely that no
// multi-slash value ever reaches the network, rather than the internal call order that currently
// produces it. Encoding stays correct on its own too (`replaceAll`), so the two are independent.
describe('package names carrying more than one slash', () => {
  it.each(['@scope/pkg/extra', 'pkg/extra', '@scope//pkg', '@scope/pkg/../other'])(
    'rejects %s without reaching the registry',
    async (name) => {
      expect.hasAssertions();
      const { fetcher, isFetched } = unfetchedFetcher();
      await expect(resolveNpmPackage(fetcher, name)).rejects.toThrow(/npm naming rules/u);
      expect(isFetched()).toBe(false);
    },
  );
});

// Without a deadline, a registry — or an intercepting proxy — that trickles a response hangs
// `refs add npm:<pkg>` for as long as it likes. `update-check.ts` already put one on its own
// registry call; this one had none, so the two disagreed about whether that was acceptable.
/** A fetcher that fails the way an expired deadline does, at the chosen leg. Rejecting with a
 * `TimeoutError` is exactly what `AbortSignal.timeout` produces — asserting only that a signal was
 * PASSED would pass for `new AbortController().signal`, which never expires. */
const abortedByTimeout = (): Promise<never> =>
  Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

const timingOutFetcher = (at: 'body' | 'request'): Fetcher => {
  const timeout = abortedByTimeout;
  return (_url, init) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return at === 'request'
      ? timeout()
      : Promise.resolve({ json: timeout, status: HTTP_STATUS_OK });
  };
};

describe('the registry request', () => {
  it('carries an abort signal, so a trickling response cannot hang the command', async () => {
    expect.hasAssertions();
    // eslint-disable-next-line init-declarations -- the point is that the fetcher sets it
    let seen: AbortSignal | undefined;
    const fetcher: Fetcher = (_url, init) => {
      seen = init?.signal;
      return Promise.resolve({
        json: () => Promise.resolve({ repository: NEXT_REPO_URL }),
        status: HTTP_STATUS_OK,
      });
    };

    await resolveNpmPackage(fetcher, 'next');

    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen?.aborted).toBe(false);
  });

  it.each([
    ['before the headers', 'request'],
    ['mid-body', 'body'],
  ] as const)('reports its own deadline as a timeout, %s', async (_label, at) => {
    expect.hasAssertions();

    // Mid-body is the one that used to lie: the abort made `response.json()` reject, and refs
    // reported "not parseable JSON" — blaming the registry for cancelling its own transfer.
    await expect(resolveNpmPackage(timingOutFetcher(at), 'next')).rejects.toThrow(
      /did not answer for 'next' within/u,
    );
  });

  it('still reports a genuinely unparseable body as unparseable', async () => {
    expect.hasAssertions();
    const fetcher: Fetcher = () =>
      Promise.resolve({
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
        status: HTTP_STATUS_OK,
      });

    await expect(resolveNpmPackage(fetcher, 'next')).rejects.toThrow(/not parseable JSON/u);
  });
});
