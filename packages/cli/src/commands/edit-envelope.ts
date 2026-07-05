// Shared normalization for the `{key, field, old, new}` envelope every `refs edit` mode returns
// (`edit-ref.ts`, `edit-package.ts`, `edit-settings.ts`). A previously-unset optional field (ref
// `clone_mode`/`sync_ttl`/`git_transport`, package `tag_format`) reads back as `undefined` from a
// plain property access — but `JSON.stringify` drops `undefined` object values entirely, so an
// unnormalized `old: undefined` would silently vanish from the JSON envelope instead of
// serializing as an explicit `null`, breaking the contracted four-key shape. Every `EditData`
// construction site runs both `old` and `new` (the latter defensively — no known path produces an
// undefined "new" today, but the contract should hold regardless) through this before returning.
const normalizeEditValue = (value: unknown): unknown => {
  if (value === undefined) {
    // eslint-disable-next-line unicorn/no-null -- cross-process JSON contract requires null, not undefined
    return null;
  }
  return value;
};

export { normalizeEditValue };
