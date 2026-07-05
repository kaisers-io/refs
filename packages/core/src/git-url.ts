import type { GitTransport, RefKey } from './schemas/primitives.ts';
import { validationError } from './errors.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { zRefKey } from './schemas/primitives.ts';

const SCP_URL = /^git@(?<host>[^:/\s]+):(?<path>[^\s]+)$/u;
const GIT_PLUS_PREFIX = /^git\+/u;
const DEFAULT_PORTS: Record<string, string> = { 'https:': '443', 'ssh:': '22' };
const MIN_FILE_SEGMENTS = 2;
const LAST_SEGMENT_OFFSET = -1;
const SECOND_LAST_SEGMENT_OFFSET = -2;

interface CanonicalizeGitUrlOptions {
  allowFileUrls?: boolean;
}

interface BuildKeyInput {
  host: string;
  path: string;
  port: string;
  protocol: string;
}

const stripGitSuffix = (path: string): string => path.replace(/\.git$/u, '');

// The WHATWG URL parser silently resolves `..`/`.` path segments before we ever see
// `url.pathname`, so traversal attempts must be caught on the raw input first.
const hasDotSegment = (raw: string): boolean =>
  raw.split('/').some((segment) => segment === '.' || segment === '..');

// Backslashes are treated as `/` by the WHATWG URL parser for special (e.g. https) schemes, so `a/b\..\c` can normalize into a traversal invisible to the raw, `/`-split check above.
// We reject any backslash outright: git clone urls never legitimately contain one.
const hasBackslash = (raw: string): boolean => raw.includes('\\');

// Percent-encoding lets a dot segment survive raw inspection (e.g. `%2e%2e`), which the WHATWG URL parser then resolves after our traversal check runs, producing a cloneUrl/key mismatch.
// Rather than decode-and-recheck every path segment, we reject any `%` in non-file forms outright: git hosts virtually never need percent-encoded paths, and zRefKey's SAFE_SEGMENT already forbids `%` in stored keys, so encoding here can only ever cause normalization surprises.
const hasPercentEncoding = (raw: string): boolean => raw.includes('%');

const parseAsRefKey = (candidate: string): RefKey => {
  const parsed = zRefKey.safeParse(candidate);
  if (!parsed.success) {
    throw validationError(`not a supported git url: derived key '${candidate}' is invalid`);
  }
  return parsed.data;
};

const hostSegmentFor = ({ host, port, protocol }: BuildKeyInput): string => {
  const defaultPort = DEFAULT_PORTS[protocol];
  if (port === '' || port === defaultPort) {
    return host.toLowerCase();
  }
  return `${host.toLowerCase()}_${port}`;
};

const buildKey = (input: BuildKeyInput): RefKey => {
  const cleanPath = stripGitSuffix(input.path.replace(/^\/+/u, '').replace(/\/+$/u, ''));
  return parseAsRefKey(`${hostSegmentFor(input)}/${cleanPath}`);
};

const buildFileKey = (pathname: string): RefKey => {
  const segments = decodeURIComponent(pathname)
    .split('/')
    .filter((segment) => segment !== '');
  if (segments.length < MIN_FILE_SEGMENTS) {
    throw validationError(
      `not a supported git url: file url path must have at least ${MIN_FILE_SEGMENTS} segments`,
    );
  }
  const secondLast = segments.at(SECOND_LAST_SEGMENT_OFFSET) ?? '';
  const last = segments.at(LAST_SEGMENT_OFFSET) ?? '';
  return parseAsRefKey(`local/${secondLast}/${last}`);
};

const parseUrl = (cloneUrl: string, original: string): URL => {
  try {
    return new URL(cloneUrl);
  } catch {
    throw validationError(`not a supported git url: ${original}`);
  }
};

// A password is unsafe to embed regardless of scheme — ssh may still carry a bare
// `username@host` pair, but https must reject both username and password.
const assertNoCredentials = (url: URL): void => {
  if (url.password !== '') {
    throw validationError('not a supported git url: credentials embedded in url');
  }
  if (url.protocol === 'https:' && url.username !== '') {
    throw validationError('not a supported git url: credentials embedded in https url');
  }
};

const resolveKeyFromUrl = (url: URL, allowFileUrls: boolean): RefKey => {
  if (url.protocol === 'file:') {
    if (!allowFileUrls) {
      throw validationError(`not a supported git url: unsupported protocol ${url.protocol}`);
    }
    return buildFileKey(url.pathname);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'ssh:') {
    throw validationError(`not a supported git url: unsupported protocol ${url.protocol}`);
  }
  assertNoCredentials(url);
  return buildKey({
    host: url.hostname,
    path: url.pathname,
    port: url.port,
    protocol: url.protocol,
  });
};

// Guards for the scp-style `git@host:path` form, which is parsed with a regexp rather than the WHATWG URL parser, and so needs its own ambiguity checks.
const assertSafeScpPath = (scpPath: string, input: string): void => {
  if (hasPercentEncoding(scpPath)) {
    throw validationError(`not a supported git url: percent-encoding not supported in ${input}`);
  }
  if (scpPath.includes(':')) {
    throw validationError(
      `not a supported git url: ambiguous ':' in scp-style path ${input}; use the ssh:// url form instead`,
    );
  }
  if (scpPath.startsWith('/') || scpPath.startsWith('~')) {
    throw validationError(
      `not a supported git url: ambiguous absolute/home-relative scp path in ${input}; use the ssh:// url form instead`,
    );
  }
};

const resolveScpKey = (scp: RegExpExecArray, input: string): RefKey => {
  const scpPath = scp.groups?.['path'] ?? '';
  assertSafeScpPath(scpPath, input);
  return buildKey({ host: scp.groups?.['host'] ?? '', path: scpPath, port: '', protocol: 'ssh:' });
};

const assertNoBackslash = (cloneUrl: string, input: string): void => {
  if (hasBackslash(cloneUrl)) {
    throw validationError(`not a supported git url: backslash not allowed in ${input}`);
  }
};

const assertNoDotSegment = (cloneUrl: string, input: string): void => {
  if (hasDotSegment(cloneUrl)) {
    throw validationError(`not a supported git url: path traversal segment in ${input}`);
  }
};

// Percent-encoding is only meaningful for `file:` urls (which encode filesystem-legal characters like spaces); https/ssh forms never need it, so any `%` there is rejected.
const assertNoPercentEncodingUnlessFile = (url: URL, cloneUrl: string, input: string): void => {
  if (url.protocol !== 'file:' && hasPercentEncoding(cloneUrl)) {
    throw validationError(`not a supported git url: percent-encoding not supported in ${input}`);
  }
};

const canonicalizeGitUrl = (
  input: string,
  opts?: CanonicalizeGitUrlOptions,
): { key: RefKey; cloneUrl: string } => {
  const allowFileUrls = opts?.allowFileUrls ?? false;
  const cloneUrl = input.replace(GIT_PLUS_PREFIX, '');
  assertNoBackslash(cloneUrl, input);
  assertNoDotSegment(cloneUrl, input);
  const scp = SCP_URL.exec(cloneUrl);
  if (scp?.groups !== undefined) {
    return { cloneUrl, key: resolveScpKey(scp, input) };
  }
  const url = parseUrl(cloneUrl, input);
  assertNoPercentEncodingUnlessFile(url, cloneUrl, input);
  return { cloneUrl, key: resolveKeyFromUrl(url, allowFileUrls) };
};

// --- git_transport transform (spec §3 transport rule) ---------------------------------------

const FILE_PROTOCOL_PREFIX = 'file:';
const GIT_SUFFIX = '.git';

const trimPathSlashes = (path: string): string => path.replace(/^\/+/u, '').replace(/\/+$/u, '');

const ensureGitSuffix = (path: string): string => {
  if (path.endsWith(GIT_SUFFIX)) {
    return path;
  }
  return `${path}${GIT_SUFFIX}`;
};

const httpsFormOf = (host: string, path: string): string =>
  `https://${host.toLowerCase()}/${trimPathSlashes(path)}`;

// The spec prescribes the scp form (`git@host:path.git`) as the ssh rewrite target; the `.git`
// suffix is added when missing to match that form (it never changes the canonical key — see
// `stripGitSuffix` in `buildKey`).
const scpFormOf = (host: string, path: string): string =>
  `git@${host.toLowerCase()}:${ensureGitSuffix(trimPathSlashes(path))}`;

const transportOfProtocol = (protocol: string, input: string): GitTransport => {
  if (protocol === 'https:') {
    return 'https';
  }
  if (protocol === 'ssh:') {
    return 'ssh';
  }
  // Unreachable in practice: `canonicalizeGitUrl` above only admits https:/ssh:/file:, and file:
  // returned early — kept as a hard error rather than a silent fall-through.
  throw validationError(`not a supported git url: unsupported protocol ${protocol} in ${input}`);
};

// A port only survives canonicalization by being non-default (default ports are stripped from the
// key), and neither rewrite target can carry it faithfully: the scp form has no port syntax at
// all, and stamping an ssh port onto an https url (or vice versa) would produce a url for a
// different endpoint. Rejecting is the only honest option (spec §3).
const rejectNonDefaultPort = (url: URL, transport: GitTransport, input: string): void => {
  const defaultPort = DEFAULT_PORTS[url.protocol];
  if (url.port !== '' && url.port !== defaultPort) {
    throw validationError(
      `cannot apply git_transport=${transport} to ${input}: its non-default port ${url.port} ` +
        `cannot be expressed in the ${transport} url form — add the repo with an explicit url instead`,
    );
  }
};

const targetFormOf = (url: URL, transport: GitTransport): string => {
  if (transport === 'https') {
    return httpsFormOf(url.hostname, url.pathname);
  }
  return scpFormOf(url.hostname, url.pathname);
};

// The transform's safety net: a rewrite must never change repo identity. Runs on every rewrite;
// throwing here indicates a bug in the form builders above, never a user error.
const assertKeyInvariant = (input: string, transformed: string, originalKey: RefKey): string => {
  const transformedKey = canonicalizeGitUrl(transformed).key;
  if (transformedKey !== originalKey) {
    throw validationError(
      `git_transport transform changed repo identity: '${input}' → '${transformed}' ` +
        `(key '${originalKey}' → '${transformedKey}')`,
    );
  }
  return transformed;
};

interface TransformContext {
  cloneUrl: string;
  originalKey: RefKey;
  transport: GitTransport;
}

// The scp branch of `applyGitTransport`: an scp url IS the ssh transport, so it either stays
// verbatim or rewrites to the https form.
const transformFromScp = (scp: RegExpExecArray, ctx: TransformContext): string => {
  if (ctx.transport === 'ssh') {
    return ctx.cloneUrl;
  }
  const host = scp.groups?.['host'] ?? '';
  const path = scp.groups?.['path'] ?? '';
  return assertKeyInvariant(ctx.cloneUrl, httpsFormOf(host, path), ctx.originalKey);
};

// The WHATWG-url branch of `applyGitTransport` (https:// and ssh:// forms).
const transformFromUrlForm = (ctx: TransformContext): string => {
  const url = parseUrl(ctx.cloneUrl, ctx.cloneUrl);
  if (transportOfProtocol(url.protocol, ctx.cloneUrl) === ctx.transport) {
    return ctx.cloneUrl;
  }
  rejectNonDefaultPort(url, ctx.transport, ctx.cloneUrl);
  return assertKeyInvariant(ctx.cloneUrl, targetFormOf(url, ctx.transport), ctx.originalKey);
};

/** Rewrites `cloneUrl` to the requested `transport` (spec §3 transport rule): https ↔ the scp
 * ssh form `git@host:path.git`. Only `npm:`-resolved urls are ever passed here — a url the user
 * typed explicitly is used verbatim by the add flow and never reaches this function. A url
 * already on the requested transport is returned byte-for-byte unchanged (including one with a
 * non-default port); `file:` urls — the test-only escape hatch, which npm resolution can never
 * produce — are exempt. The canonical key is transport-invariant: every rewrite is round-tripped
 * through `canonicalizeGitUrl` and a key change throws instead of returning. */
const applyGitTransport = (cloneUrl: string, transport: GitTransport): string => {
  if (cloneUrl.startsWith(FILE_PROTOCOL_PREFIX)) {
    return cloneUrl;
  }
  const originalKey = canonicalizeGitUrl(cloneUrl).key;
  const context: TransformContext = { cloneUrl, originalKey, transport };
  const scp = SCP_URL.exec(cloneUrl);
  if (scp?.groups !== undefined) {
    return transformFromScp(scp, context);
  }
  return transformFromUrlForm(context);
};

export { applyGitTransport, canonicalizeGitUrl };
export type { CanonicalizeGitUrlOptions };
