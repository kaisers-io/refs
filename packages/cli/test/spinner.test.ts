import { createSpinner, fitted, supportsUnicode } from '../src/spinner.ts';
import { describe, expect, it, vi } from 'vitest';
import type { SpinnerStream } from '../src/spinner.ts';

// The renderer against a fake terminal. What these pin: nothing is ever written unless a person is
// watching a terminal, a fast command never flashes a frame, a stopped spinner stays stopped and
// leaves a cleared line, and a label can neither wrap the line nor move the cursor.

const CLEAR_LINE = '\r\u001B[K';
const TRUE_COLOR = 24;
const NO_COLOR = 1;
const PALETTE_256 = 8;
const BASIC_16 = 4;
const LOGO_GREEN = '\u001B[38;2;7;210;86m';
const BEFORE_FIRST_FRAME_MS = 99;
const FIRST_FRAME_MS = 100;
const DOTS_INTERVAL_MS = 80;
const NARROW = 20;
const LONG_AFTER_MS = 1000;
const LAST = -1;

type FakeTerminal = { stream: SpinnerStream; writes: string[] };

// Every test here runs on fake timers; vitest gives each test file its own module state.
const terminal = (overrides: Partial<SpinnerStream> = {}): FakeTerminal => {
  vi.useFakeTimers();
  const writes: string[] = [];
  const stream: SpinnerStream = {
    columns: 80,
    getColorDepth: () => TRUE_COLOR,
    isTTY: true,
    write: (chunk) => writes.push(chunk),
    ...overrides,
  };
  return { stream, writes };
};

const MAC = 'darwin';
const XTERM = { TERM: 'xterm-256color' };

describe('createSpinner: when it draws at all', () => {
  it.each([
    ['stderr is not a terminal', XTERM, { isTTY: false }],
    ['TERM is dumb', { TERM: 'dumb' }, {}],
    ['CI is set', { ...XTERM, CI: 'true' }, {}],
    ['REFS_PROGRESS is 0', { ...XTERM, REFS_PROGRESS: '0' }, {}],
  ])('writes nothing when %s', (_reason, env, stream) => {
    expect.hasAssertions();
    const fake = terminal(stream);
    const spinner = createSpinner({ env, platform: MAC, stream: fake.stream });
    spinner.update('Checking Git');
    vi.advanceTimersByTime(LONG_AFTER_MS);
    spinner.stop();
    expect(fake.writes).toStrictEqual([]);
  });

  it('draws with CI=false, which is not CI', () => {
    expect.hasAssertions();
    const fake = terminal();
    const spinner = createSpinner({
      env: { ...XTERM, CI: 'false' },
      platform: MAC,
      stream: fake.stream,
    });
    spinner.update('Checking Git');
    vi.advanceTimersByTime(FIRST_FRAME_MS);
    expect(fake.writes).toHaveLength(1);
  });
});

describe('createSpinner: drawing', () => {
  it('shows nothing for the first 100 ms, then the first dots frame in logo green with the label', () => {
    expect.hasAssertions();
    const fake = terminal();
    const spinner = createSpinner({ env: XTERM, platform: MAC, stream: fake.stream });
    spinner.update('Checking Git');
    vi.advanceTimersByTime(BEFORE_FIRST_FRAME_MS);
    expect(fake.writes).toStrictEqual([]);
    vi.advanceTimersByTime(1);
    expect(fake.writes).toStrictEqual([`${CLEAR_LINE}${LOGO_GREEN}⠋\u001B[39m Checking Git ...`]);
  });

  it('advances a frame every 80 ms and shows the latest label', () => {
    expect.hasAssertions();
    const fake = terminal({ getColorDepth: () => NO_COLOR });
    const spinner = createSpinner({ env: XTERM, platform: MAC, stream: fake.stream });
    spinner.update('Checking Git');
    vi.advanceTimersByTime(FIRST_FRAME_MS);
    spinner.update('Checking locks');
    vi.advanceTimersByTime(DOTS_INTERVAL_MS);
    expect(fake.writes.at(LAST)).toBe(`${CLEAR_LINE}⠙ Checking locks ...`);
  });

  it('falls back to the line frames where Unicode may not render', () => {
    expect.hasAssertions();
    const fake = terminal({ getColorDepth: () => NO_COLOR });
    const spinner = createSpinner({
      env: { TERM: 'linux' },
      platform: 'linux',
      stream: fake.stream,
    });
    spinner.update('Checking Git');
    vi.advanceTimersByTime(FIRST_FRAME_MS);
    expect(fake.writes).toStrictEqual([`${CLEAR_LINE}- Checking Git ...`]);
  });
});

describe('createSpinner: colour', () => {
  it.each([
    [PALETTE_256, '\u001B[38;5;41m'],
    [BASIC_16, '\u001B[32m'],
  ])('uses the nearest logo green a %i-bit terminal can show', (depth, code) => {
    expect.hasAssertions();
    const fake = terminal({ getColorDepth: () => depth });
    const spinner = createSpinner({ env: XTERM, platform: MAC, stream: fake.stream });
    spinner.update('Checking Git');
    vi.advanceTimersByTime(FIRST_FRAME_MS);
    expect(fake.writes).toStrictEqual([`${CLEAR_LINE}${code}⠋\u001B[39m Checking Git ...`]);
  });
});

describe('createSpinner: stopping', () => {
  it('clears the line once, and a later update draws nothing', () => {
    expect.hasAssertions();
    const fake = terminal();
    const spinner = createSpinner({ env: XTERM, platform: MAC, stream: fake.stream });
    spinner.update('Checking Git');
    vi.advanceTimersByTime(FIRST_FRAME_MS);
    spinner.stop();
    spinner.stop();
    spinner.update('Checking locks');
    vi.advanceTimersByTime(LONG_AFTER_MS);
    expect(fake.writes.slice(1)).toStrictEqual([CLEAR_LINE]);
  });

  it('writes nothing at all when stopped before the first frame', () => {
    expect.hasAssertions();
    const fake = terminal();
    const spinner = createSpinner({ env: XTERM, platform: MAC, stream: fake.stream });
    spinner.update('Checking Git');
    spinner.stop();
    vi.advanceTimersByTime(LONG_AFTER_MS);
    expect(fake.writes).toStrictEqual([]);
  });
});

describe('fitting a label into the terminal width', () => {
  it('fits the label and its ellipsis into the width', () => {
    expect.hasAssertions();
    expect(fitted('Syncing refs (3/8 done): github.com/vercel/next.js', NARROW)).toBe(
      'Syncing refs (3/ ...',
    );
    expect(fitted('Syncing refs', NARROW)).toBe('Syncing refs ...');
  });

  it('keeps a label from moving the cursor or taking two cells per character', () => {
    expect.hasAssertions();
    expect(fitted('a\u001B[2Jb\r\nc漢', NARROW)).toBe('a?[2Jb??c? ...');
  });

  it('gives up on the label rather than wrapping in a very narrow terminal', () => {
    expect.hasAssertions();
    expect(fitted('Checking Git', 1)).toBe('');
  });
});

describe('deciding whether Unicode frames will render', () => {
  it('follows is-unicode-supported on Windows', () => {
    expect.hasAssertions();
    expect(supportsUnicode({}, 'win32')).toBe(false);
    expect(supportsUnicode({ WT_SESSION: 'x' }, 'win32')).toBe(true);
    expect(supportsUnicode({ TERM_PROGRAM: 'vscode' }, 'win32')).toBe(true);
    expect(supportsUnicode({ TERM: 'linux' }, 'linux')).toBe(false);
  });
});
