const EXIT = {
  CONFLICT: 5,
  NOT_FOUND: 4,
  OK: 0,
  UNEXPECTED: 1,
  USAGE: 2,
  VALIDATION: 3,
} as const;

type ErrorCode = 'usage' | 'validation' | 'not_found' | 'conflict' | 'unexpected';

class RefsError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;

  // eslint-disable-next-line oxc/max-params -- opts needed for cause-chaining per contract
  constructor(exitCode: number, code: ErrorCode, message: string, opts?: { cause?: unknown }) {
    super(message, opts);
    this.code = code;
    this.exitCode = exitCode;
    this.name = 'RefsError';
  }
}

const conflictError = (message: string): RefsError =>
  new RefsError(EXIT.CONFLICT, 'conflict', message);
const notFoundError = (message: string): RefsError =>
  new RefsError(EXIT.NOT_FOUND, 'not_found', message);
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
): { code: ErrorCode; exitCode: number; message: string } => {
  if (err instanceof RefsError) {
    return {
      code: err.code,
      exitCode: err.exitCode,
      message: withStack(err.message, err.stack, opts.verbose),
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
export type { ErrorCode };
