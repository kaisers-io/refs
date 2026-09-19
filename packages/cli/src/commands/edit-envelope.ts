// Shared normalization for the `{key, field, old, new}` envelope every `refs edit` mode returns
// (`edit-ref.ts`, `edit-package.ts`, `edit-settings.ts`). A previously-unset optional field (ref
// `clone_mode`/`sync_ttl`/`git_transport`, package `tag_format`) reads back as `undefined` from a
// plain property access — but `JSON.stringify` drops `undefined` object values entirely, so an
// unnormalized `old: undefined` would silently vanish from the JSON envelope instead of
// serializing as an explicit `null`, breaking the contracted four-key shape. Both `old` and `new`
// go through it (the latter defensively — no known path produces an undefined "new" today, but the
// contract should hold regardless).
//
// It is not the enforcement point, and reading it as one is the trap: `edit-decline.ts` builds its
// envelope from literals and never calls this. The contract holds there by construction rather
// than by normalization, so a new writer has to satisfy it the same way or come through here.
const normalizeEditValue = (value: unknown): unknown => {
  if (value === undefined) {
    // eslint-disable-next-line unicorn/no-null -- cross-process JSON contract requires null, not undefined
    return null;
  }
  return value;
};

export { normalizeEditValue };
