const EXIT = {
  CONFLICT: 5,
  NOT_FOUND: 4,
  OK: 0,
  UNEXPECTED: 1,
  USAGE: 2,
  VALIDATION: 3,
} as const;

type ErrorCode = 'usage' | 'validation' | 'not_found' | 'conflict' | 'unexpected';

/** What a `not_found` actually established, for a caller that must not over-read it.
 *
 * `code: 'not_found'` alone says a lookup came back empty, which is not the same fact as "the
 * thing does not exist" — and an agent that reads it as the latter reports something untrue and
 * stops. These name the scope that was searched instead:
 *
 *   - `unmatched_query` — nothing in the configuration matched the query, by any route. The
 *     intended repository is unknown; it may well be tracked under another identifier.
 *   - `package_not_registered` — the ref was identified, and it registers no package under that
 *     name. A fact about that ref's package map, not about the repository.
 *   - `ref_not_registered` — a query that names a ref outright (a canonical git url, an explicit
 *     `--ref`) named one the active configuration does not have. This is the only one of the three
 *     that supports "add it".
 *
 * Kept deliberately small. Every value must be something the code can actually establish; there is
 * no value for "the repository does not exist", because nothing here can determine that.
 *
 * ABSENT on most `not_found` errors, and that is the honest default rather than an oversight. These
 * three narrow one thing — `resolve`'s routing of a query onto a ref or package. A missing config,
 * an absent checkout, a `show` on an unknown ref are different failures, and inventing a reason for
 * each would grow this union past the point where a caller can branch on it usefully. A caller that
 * sees no reason has learned exactly what `code: 'not_found'` already told it: a lookup came back
 * empty. It must not read more into that. */
type NotFoundReason = 'package_not_registered' | 'ref_not_registered' | 'unmatched_query';

class RefsError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;
  /** Narrows what a `not_found` established — see `NotFoundReason`. Absent on every other code. */
  readonly reason?: NotFoundReason;

  // eslint-disable-next-line oxc/max-params -- mirrors Error's (message, opts) tail so `cause` chains through, prefixed by refs' exit metadata
  constructor(
    exitCode: number,
    code: ErrorCode,
    message: string,
    opts?: { cause?: unknown; reason?: NotFoundReason },
  ) {
    super(message, opts);
    this.code = code;
    this.exitCode = exitCode;
    this.name = 'RefsError';
    if (opts?.reason !== undefined) {
      this.reason = opts.reason;
    }
  }
}

const conflictError = (message: string): RefsError =>
  new RefsError(EXIT.CONFLICT, 'conflict', message);
const notFoundError = (message: string, reason?: NotFoundReason): RefsError =>
  new RefsError(
    EXIT.NOT_FOUND,
    'not_found',
    message,
    reason === undefined ? undefined : { reason },
  );
const usageError = (message: string): RefsError => new RefsError(EXIT.USAGE, 'usage', message);
const validationError = (message: string): RefsError =>
  new RefsError(EXIT.VALIDATION, 'validation', message);

const withStack = (message: string, stack: string | undefined, verbose: boolean): string => {
  if (verbose && stack !== undefined) {
    return `${message}\n${stack}`;
  }
  return message;
};

const renderError = (
  err: unknown,
  opts: { verbose: boolean },
): { code: ErrorCode; exitCode: number; message: string; reason?: NotFoundReason } => {
  if (err instanceof RefsError) {
    return {
      code: err.code,
      exitCode: err.exitCode,
      message: withStack(err.message, err.stack, opts.verbose),
      ...(err.reason === undefined ? {} : { reason: err.reason }),
    };
  }
  if (err instanceof Error) {
    return {
      code: 'unexpected',
      exitCode: EXIT.UNEXPECTED,
      message: withStack(err.message, err.stack, opts.verbose),
    };
  }
  return { code: 'unexpected', exitCode: EXIT.UNEXPECTED, message: String(err) };
};

export { EXIT, RefsError, conflictError, notFoundError, renderError, usageError, validationError };
export type { ErrorCode, NotFoundReason };
