import { z } from 'zod';

const CLONE_MODES = ['blobless', 'full'] as const;
const GIT_TRANSPORTS = ['ssh', 'https'] as const;

// One or more safe path segments: no dots-only segments, no slashes, backslashes, percent escapes,
// or colons — ref keys and package paths are untrusted input that becomes filesystem paths under
// the refs home. Colons are rejected because `C:` is a Windows drive/NTFS-alternate-stream
// separator, and because scp-style `host:port` ambiguity already caused a key-collision bug in
// git-url.ts's scp handling.
const SAFE_SEGMENT = /^(?!\.{1,2}$)[^/\\%:]+$/u;
// Host: lowercase DNS name, optionally suffixed with _<port> for non-default ports.
// Port must be in range 1-65535; validated further in zRefKey refine.
const HOST_SEGMENT = /^[a-z0-9][a-z0-9.-]*(?:_[1-9]\d{0,4})?$/u;
const DURATION = /^(?<amount>[1-9]\d{0,3})(?<unit>[mhd])$/u;

// eslint-disable-next-line id-length -- keys are the literal duration unit suffixes (m/h/d)
const MS_PER_UNIT = { d: 86_400_000, h: 3_600_000, m: 60_000 } as const;
const MIN_PATH_SEGMENTS = 2;
const EMPTY_PATH_LENGTH = 0;
const MIN_PORT = 1;
const MAX_PORT = 65_535;

const isValidDnsLabel = (label: string): boolean =>
  label !== '' && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label);

const isValidPort = (portStr: string | undefined): boolean => {
  if (portStr === undefined) {
    return true;
  }
  const port = Number(portStr);
  return port >= MIN_PORT && port <= MAX_PORT;
};

const isValidHostSegment = (host: string): boolean => {
  // `HOST_SEGMENT` (checked before this runs) admits at most one `_`, so a single split recovers
  // the dns name and the optional port.
  const [dnsName = '', port] = host.split('_');
  if (!isValidPort(port)) {
    return false;
  }
  const labels = dnsName.split('.');
  return labels.every((label) => isValidDnsLabel(label));
};

const zRefKey = z
  .string()
  .refine((raw) => {
    const segments = raw.split('/');
    const [host, ...path] = segments;
    if (host === undefined || path.length < MIN_PATH_SEGMENTS) {
      return false;
    }
    if (!HOST_SEGMENT.test(host)) {
      return false;
    }
    if (!isValidHostSegment(host)) {
      return false;
    }
    return path.every((seg) => SAFE_SEGMENT.test(seg));
  }, 'ref key must be host/path…/repo with safe, non-empty segments')
  .brand<'RefKey'>();

const zDuration = z
  .string()
  .regex(DURATION, 'duration must be <n>m, <n>h, or <n>d')
  .brand<'Duration'>();

const durationToMs = (duration: Duration): number => {
  const match = DURATION.exec(duration);
  if (match === null) {
    throw new Error(`invalid duration: ${duration}`);
  }
  const { amount, unit } = match.groups ?? {};
  if (!amount || !unit) {
    throw new Error(`invalid duration: ${duration}`);
  }
  return Number(amount) * MS_PER_UNIT[unit as keyof typeof MS_PER_UNIT];
};

const zCloneMode = z.enum(CLONE_MODES);
const zGitTransport = z.enum(GIT_TRANSPORTS);

const zTagFormat = z
  .string()
  .refine((raw) => raw.includes('{version}'), 'tag format must contain {version}');

const zPackagePath = z.string().refine((raw) => {
  if (raw === '.') {
    return true;
  }
  const segments = raw.split('/');
  return (
    segments.length > EMPTY_PATH_LENGTH &&
    segments.every((seg) => SAFE_SEGMENT.test(seg) && seg !== '.')
  );
}, 'package path must be "." or a normalized relative path without traversal');

type CloneMode = z.infer<typeof zCloneMode>;
type Duration = z.infer<typeof zDuration>;
type GitTransport = z.infer<typeof zGitTransport>;
type RefKey = z.infer<typeof zRefKey>;
type TagFormat = z.infer<typeof zTagFormat>;

export {
  CLONE_MODES,
  durationToMs,
  GIT_TRANSPORTS,
  zCloneMode,
  zDuration,
  zGitTransport,
  zPackagePath,
  zRefKey,
  zTagFormat,
};
export type { CloneMode, Duration, GitTransport, RefKey, TagFormat };
