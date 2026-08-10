import { notFoundError, usageError, validationError } from './errors.ts';
import type { RefKey } from './schemas/primitives.ts';
import { canonicalizeGitUrl } from './git-url.ts';
import { z } from 'zod';
import { zPackagePath } from './schemas/primitives.ts';

// Injectable HTTP client; production passes the global `fetch`.
type Fetcher = (url: string) => Promise<{ json: () => Promise<unknown>; status: number }>;

type ResolvedNpmPackage = {
  cloneUrl: string;
  directory?: string;
  key: RefKey;
};

// External data → loose objects (unknown extra keys pass through).
const zRepositoryObject = z.looseObject({
  directory: z.string().optional(),
  url: z.string().optional(),
});
const zRepository = z.union([z.string(), zRepositoryObject]);
const zNpmPackument = z.looseObject({ repository: zRepository.optional() });

type NpmPackument = z.infer<typeof zNpmPackument>;
type NpmRepository = NpmPackument['repository'];

// Modern npm naming rules: lowercase, url-safe, optional @scope/ prefix.
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9._~-]*\/)?[a-z0-9-~][a-z0-9._~-]*$/u;
const PACKAGE_NAME_MAX_LENGTH = 214;
const RESERVED_UNSCOPED_NAMES = new Set(['node_modules', 'favicon.ico']);

const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_OK = 200;

const noUsableRepositoryError = (pkgName: string): Error =>
  notFoundError(
    `package '${pkgName}' has no usable repository field — find the repository and run: refs add <git-url>`,
  );

// `@scope/pkg` → `pkg`; unscoped names contain no `/`. Validation caps names at one slash.
const getUnscopedName = (pkgName: string): string => {
  const [head, scopedName] = pkgName.split('/');
  return scopedName ?? head ?? pkgName;
};

const validatePackageName = (pkgName: string): void => {
  if (pkgName.length > PACKAGE_NAME_MAX_LENGTH) {
    throw usageError(
      `invalid package name: '${pkgName}' exceeds maximum length of ${PACKAGE_NAME_MAX_LENGTH} characters`,
    );
  }
  if (!PACKAGE_NAME_PATTERN.test(pkgName)) {
    throw usageError(`invalid package name: '${pkgName}' does not match npm naming rules`);
  }
  const unscoped = getUnscopedName(pkgName);
  if (RESERVED_UNSCOPED_NAMES.has(unscoped)) {
    throw usageError(`invalid package name: '${pkgName}' uses a reserved name`);
  }
};

// Scoped names encode only the inner slash (`@scope/pkg` → `@scope%2Fpkg`). `validatePackageName`
// runs before every call and admits at most that one slash, so `replaceAll` and `replace` cannot
// differ here. It is `replaceAll` anyway: the version that stays correct if a second caller ever
// appears is worth more than the one that needs the caller checked to be read as correct.
const encodePackageName = (pkgName: string): string => pkgName.replaceAll('/', '%2F');

const extractRepositoryUrl = (repository: NpmRepository): string | undefined => {
  if (typeof repository === 'string') {
    return repository;
  }
  return repository?.url;
};

// Directory passes through only if valid: untrusted registry input must be validated with zPackagePath.
// Invalid directories are silently dropped (the repo URL is still usable as a best-effort hint).
const extractDirectory = (repository: NpmRepository): string | undefined => {
  if (typeof repository === 'object' && repository?.directory) {
    const result = zPackagePath.safeParse(repository.directory);
    if (result.success) {
      return result.data;
    }
  }
  return undefined;
};

const parseResponseJson = async (
  response: { json: () => Promise<unknown> },
  pkgName: string,
): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw validationError(`invalid npm registry response for '${pkgName}': not parseable JSON`);
  }
};

const fetchPackument = async (fetcher: Fetcher, pkgName: string): Promise<NpmPackument> => {
  const response = await fetcher(`https://registry.npmjs.org/${encodePackageName(pkgName)}`);
  if (response.status === HTTP_STATUS_NOT_FOUND) {
    throw notFoundError(`npm package '${pkgName}' not found`);
  }
  if (response.status !== HTTP_STATUS_OK) {
    throw validationError(`failed to fetch npm package '${pkgName}': status ${response.status}`);
  }
  const body: unknown = await parseResponseJson(response, pkgName);
  const parsed = zNpmPackument.safeParse(body);
  if (!parsed.success) {
    throw validationError(`invalid npm package response for '${pkgName}'`);
  }
  return parsed.data;
};

// Unsupported url forms (e.g. the `github:` shorthand) are treated exactly like a missing
// repository field: fail with a not_found that points the user at `refs add <git-url>`.
const canonicalizeRepository = (
  repositoryUrl: string,
  pkgName: string,
): { cloneUrl: string; key: RefKey } => {
  try {
    return canonicalizeGitUrl(repositoryUrl);
  } catch {
    throw noUsableRepositoryError(pkgName);
  }
};

const resolveNpmPackage = async (
  fetcher: Fetcher,
  pkgName: string,
): Promise<ResolvedNpmPackage> => {
  validatePackageName(pkgName);
  const packument = await fetchPackument(fetcher, pkgName);
  const repositoryUrl = extractRepositoryUrl(packument.repository);
  if (repositoryUrl === undefined || repositoryUrl === '') {
    throw noUsableRepositoryError(pkgName);
  }
  const { cloneUrl, key } = canonicalizeRepository(repositoryUrl, pkgName);
  const directory = extractDirectory(packument.repository);
  if (directory === undefined) {
    return { cloneUrl, key };
  }
  return { cloneUrl, directory, key };
};

export { resolveNpmPackage };
export type { Fetcher, ResolvedNpmPackage };
