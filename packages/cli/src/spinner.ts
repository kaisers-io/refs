import { isCi } from '@kaisers-io/refs-core';

// A one-line spinner on stderr that tells a person at a terminal what a long command is doing.
// Agents never see it: commands pass `--json`, which turns it off before this module is asked, and
// it is also off whenever stderr is not a terminal. It has no dependency on purpose. The CLI ships
// as a single bundle, a spinner library costs 6-46 KB, and the small ones replace `process.exit` on
// SIGINT, which would cut across the child-process cleanup in core's `spawn-cleanup.ts`. So there
// are no signal handlers here, no stream interception and no stdin handling, and the cursor stays
// visible: an interrupted run cannot leave it hidden.

type Spinner = {
  stop: () => void;
  update: (text: string) => void;
};

/** The part of a `tty.WriteStream` the renderer uses, so tests can hand it a fake. */
type SpinnerStream = {
  columns?: number;
  hasColors?: (env: NodeJS.ProcessEnv) => boolean;
  isTTY?: boolean;
  write: (chunk: string) => unknown;
};

type SpinnerOptions = {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  stream: SpinnerStream;
};

const doNothing = (): void => {
  // A spinner that is off has nothing to draw and nothing to clear.
};

const NO_SPINNER: Spinner = { stop: doNothing, update: doNothing };

// ora's defaults, from cli-spinners: `dots`, and `line` where Unicode may not render.
const DOTS = { frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'], interval: 80 };
const LINE = { frames: ['-', '\\', '|', '/'], interval: 130 };

// A command that finishes this fast never shows a spinner at all.
const FIRST_FRAME_DELAY_MS = 100;
const CLEAR_LINE = '\r\u001B[K';
const CYAN = '\u001B[36m';
const DEFAULT_FOREGROUND = '\u001B[39m';
const DEFAULT_COLUMNS = 80;
// The frame, the space after it, and one spare column so the line never wraps.
const RESERVED_COLUMNS = 3;
// Display text is kept to printable ASCII, so one character is one terminal cell and nothing in a
// label can move the cursor.
const NOT_PRINTABLE_ASCII = /[^ -~]/gu;

const isOn = (env: NodeJS.ProcessEnv, stream: SpinnerStream): boolean =>
  stream.isTTY === true &&
  env['TERM'] !== 'dumb' &&
  !isCi(env) &&
  env['REFS_PROGRESS']?.trim() !== '0';

// `is-unicode-supported`'s rules: everywhere but the Linux kernel console, and on Windows only in
// terminals known to render it.
const WINDOWS_UNICODE_TERMS = new Set([
  'alacritty',
  'rxvt-unicode',
  'rxvt-unicode-256color',
  'xterm-256color',
]);

const supportsUnicode = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean => {
  if (platform !== 'win32') {
    return env['TERM'] !== 'linux';
  }
  return (
    Boolean(env['WT_SESSION']) ||
    Boolean(env['TERMINUS_SUBLIME']) ||
    env['ConEmuTask'] === '{cmd::Cmder}' ||
    env['TERM_PROGRAM'] === 'Terminus-Sublime' ||
    env['TERM_PROGRAM'] === 'vscode' ||
    env['TERMINAL_EMULATOR'] === 'JetBrains-JediTerm' ||
    WINDOWS_UNICODE_TERMS.has(env['TERM'] ?? '')
  );
};

/** `text`, made safe and fitted into `width` cells, ellipsis included. */
const fitted = (text: string, width: number, unicode: boolean): string => {
  const ellipsis = unicode ? '…' : '...';
  const safe = text.replaceAll(NOT_PRINTABLE_ASCII, '?');
  const room = width - ellipsis.length;
  if (room <= 0) {
    return '';
  }
  return `${safe.length > room ? safe.slice(0, room) : safe}${ellipsis}`;
};

const lineFor = (options: SpinnerOptions, frame: string, text: string): string => {
  const unicode = supportsUnicode(options.env, options.platform);
  const width = (options.stream.columns ?? DEFAULT_COLUMNS) - RESERVED_COLUMNS;
  const colored = options.stream.hasColors?.(options.env) === true;
  const painted = colored ? `${CYAN}${frame}${DEFAULT_FOREGROUND}` : frame;
  return `${CLEAR_LINE}${painted} ${fitted(text, width, unicode)}`;
};

/** A spinner that draws on `stream`, or one that does nothing when this is not a terminal a
 * person is watching. Once stopped it stays stopped: a late update never redraws. */
const createSpinner = (options: SpinnerOptions): Spinner => {
  if (!isOn(options.env, options.stream)) {
    return NO_SPINNER;
  }
  const { frames, interval } = supportsUnicode(options.env, options.platform) ? DOTS : LINE;
  const state = { drawn: false, index: 0, stopped: false, text: '' };
  const draw = (): void => {
    options.stream.write(lineFor(options, frames[state.index % frames.length] ?? '', state.text));
    state.drawn = true;
    state.index += 1;
  };
  const timers: { delay?: NodeJS.Timeout; ticker?: NodeJS.Timeout } = {};
  const begin = (): void => {
    draw();
    // `unref`: never the reason the process stays alive.
    timers.ticker = setInterval(draw, interval).unref();
  };
  return {
    stop: () => {
      state.stopped = true;
      clearTimeout(timers.delay);
      clearInterval(timers.ticker);
      if (state.drawn) {
        options.stream.write(CLEAR_LINE);
        state.drawn = false;
      }
    },
    update: (text) => {
      if (state.stopped) {
        return;
      }
      state.text = text;
      timers.delay ??= setTimeout(begin, FIRST_FRAME_DELAY_MS).unref();
    },
  };
};

export { NO_SPINNER, createSpinner, fitted, supportsUnicode };
export type { Spinner, SpinnerStream };
