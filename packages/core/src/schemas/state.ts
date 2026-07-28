import { DANGEROUS_RECORD_KEYS, withValidatedKeys } from './record-keys.ts';
import { z } from 'zod';
import { zCloneMode } from './primitives.ts';

const zRefState = z.strictObject({
  effective_clone_mode: zCloneMode.optional(),
  head_sha: z
    .string()
    .regex(/^[0-9a-f]{40}$/u, 'head_sha must be a 40-character lowercase hex string')
    .optional(),
  last_error: z.string().optional(),
  last_fetched_at: z.iso.datetime().optional(),
  pending_proposal_at: z.iso.datetime().optional(),
});

const STATE_KEY_ISSUE_MESSAGE =
  'state ref key must be non-empty and not "__proto__", "constructor", or "prototype"';

const zStateRefsRecord = z.record(z.string(), zRefState);

// State stays intentionally lax — no `zRefKey` requirement, since this record is
// machine-managed and self-healing (state entries are derived, not user-authored config).
// It still needs the dangerous/empty-key guard: bare `z.record` silently DROPS a `"__proto__"`
// key instead of rejecting it (see the `withValidatedKeys` comment in record-keys.ts), which
// would make `safeParse` report success with the ref silently gone.
const zStateRefs = withValidatedKeys(
  (key) => key.length > 0 && !DANGEROUS_RECORD_KEYS.has(key),
  () => STATE_KEY_ISSUE_MESSAGE,
  zStateRefsRecord,
);

const zState = z.strictObject({
  refs: zStateRefs.default({}),
});

type RefState = z.infer<typeof zRefState>;
type State = z.infer<typeof zState>;

export { zRefState, zState };
export type { RefState, State };
