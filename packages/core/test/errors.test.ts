import {
  EXIT,
  RefsError,
  conflictError,
  notFoundError,
  renderError,
  usageError,
  validationError,
} from '../src/errors.ts';
import { describe, expect, it } from 'vitest';

describe('errors', () => {
  it('factories produce RefsError with exit code and code', () => {
    expect.hasAssertions();
    expect(usageError('u')).toMatchObject({ code: 'usage', exitCode: EXIT.USAGE, message: 'u' });
    expect(validationError('v').exitCode).toBe(EXIT.VALIDATION);
    expect(notFoundError('n').exitCode).toBe(EXIT.NOT_FOUND);
    expect(conflictError('c').exitCode).toBe(EXIT.CONFLICT);
    expect(usageError('u')).toBeInstanceOf(RefsError);
  });

  it('renderError maps RefsError, Error, and non-errors', () => {
    expect.hasAssertions();
    expect(renderError(notFoundError('missing'), { verbose: false })).toStrictEqual({
      code: 'not_found',
      exitCode: EXIT.NOT_FOUND,
      message: 'missing',
    });
    expect(renderError(new Error('boom'), { verbose: false })).toStrictEqual({
      code: 'unexpected',
      exitCode: EXIT.UNEXPECTED,
      message: 'boom',
    });
    expect(renderError('weird', { verbose: false })).toStrictEqual({
      code: 'unexpected',
      exitCode: EXIT.UNEXPECTED,
      message: 'weird',
    });
  });

  it('renderError appends stack only when verbose', () => {
    expect.hasAssertions();
    const err = validationError('bad');
    expect(renderError(err, { verbose: true }).message).toContain('at ');
    expect(renderError(err, { verbose: false }).message).toBe('bad');
  });

  it('preserves cause on RefsError', () => {
    expect.hasAssertions();
    const cause = new Error('inner');
    const err = new RefsError(EXIT.VALIDATION, 'validation', 'outer', { cause });
    expect(err.cause).toBe(cause);
  });
});
