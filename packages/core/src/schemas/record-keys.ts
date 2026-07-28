import { z } from 'zod';

// Dangerous own-keys that must never be silently accepted or silently dropped from a record.
const DANGEROUS_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Validates record keys on the RAW input, before `z.record` builds its parsed output object.
// `z.record` constructs its output via plain property assignment (`out[key] = value`), which
// silently DROPS a `"__proto__"` key: `JSON.parse('{"__proto__":…}')` produces `"__proto__"` as a
// real own key, but assigning to it on a plain object hits the prototype setter instead of
// creating an own property. A `.superRefine` that runs *after* z.record has already built its
// output therefore never sees the dropped key — the malformed key is lost rather than rejected,
// so `safeParse` reports success with the entry silently gone. Checking `Reflect.ownKeys` on the
// raw input here, in a `z.preprocess` step that runs before the record schema, catches it: any
// issue added via `ctx.addIssue` aborts the pipe before `z.record` ever runs (Zod 4's
// `ZodPipe`/`ZodPreprocess` short-circuits once the upstream step has issues).
const withValidatedKeys = <Schema extends z.ZodType>(
  keyCheck: (key: string) => boolean,
  message: (key: string) => string,
  schema: Schema,
) =>
  z.preprocess((raw, ctx) => {
    if (raw !== null && typeof raw === 'object') {
      for (const key of Reflect.ownKeys(raw)) {
        if (typeof key !== 'string' || !keyCheck(key)) {
          ctx.addIssue({ code: 'custom', message: message(String(key)), path: [String(key)] });
        }
      }
    }
    return raw;
  }, schema);

const PACKAGE_KEY_ISSUE_MESSAGE =
  'package key must be non-empty and not "__proto__", "constructor", or "prototype"';

const isSafePackageKey = (key: string): boolean =>
  key.length > 0 && !DANGEROUS_RECORD_KEYS.has(key);

// Shared guard for any "packages" record (config refs, proposal, final proposal): rejects
// empty keys and dangerous own-keys (`__proto__`, `constructor`, `prototype`) instead of
// silently dropping them the way bare `z.record` would (see `withValidatedKeys` above).
const zSafePackagesRecord = <Value extends z.ZodType>(valueSchema: Value) =>
  withValidatedKeys(
    isSafePackageKey,
    () => PACKAGE_KEY_ISSUE_MESSAGE,
    z.record(z.string().min(1), valueSchema),
  );

export { DANGEROUS_RECORD_KEYS, PACKAGE_KEY_ISSUE_MESSAGE, withValidatedKeys, zSafePackagesRecord };
