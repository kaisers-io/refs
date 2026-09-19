// What git accepts as a branch name, as a predicate a schema can call.
//
// `default_branch` used to be stored as ordinary text, and a branch name is not ordinary text: git
// refuses one that begins with `-`, and the refusal arrives at the first `refs sync`, phrased as
// git's complaint about a value nobody typed. Such a name reaches refs from a real repository —
// `git branch` will not create one, but the ref FORMAT permits it, `update-ref` writes it, it
// clones through, and `HEAD` may point at it — so `refs add` records it and the ref can never be
// synchronised.
//
// Reimplemented here rather than asked of git, because a Zod refinement is synchronous and pure
// while `git check-ref-format --branch` is a child process. The risk that carries is being STRICTER
// than git, which would make an existing config unreadable rather than merely refusing a new one —
// so `branch-name.test.ts` puts every case past the real `git check-ref-format --branch` and
// asserts the two agree, rather than asserting what this file happens to do.
//
// Measured against git 2.54, not derived from the prose: `@` alone is accepted in `--branch` mode
// though the refname rules describe it as reserved, `HEAD` is refused while `FETCH_HEAD` and
// `ORIG_HEAD` are accepted, and a name is checked as a name even when it is shaped like an option
// (`git check-ref-format --branch --quiet` reports an invalid branch name rather than parsing a
// flag).

/** Refused anywhere in the name: ASCII control characters, DEL, space, and the characters git
 * reserves for revision syntax. A backslash is included — git rejects it outright. */
const FORBIDDEN_CHARACTER = /[\p{Cc} ~^:?*[\\]/u;
/** The one name `--branch` mode rejects that the refname rules allow, because a branch called
 * `HEAD` cannot be told apart from the symbolic ref. */
const RESERVED = 'HEAD';

const componentIsWellFormed = (component: string): boolean =>
  component.length > 0 && !component.startsWith('.') && !component.endsWith('.lock');

/** Whether git would accept `name` as a branch name — the same answer as
 * `git check-ref-format --branch <name>`, which this is checked against. */
const isBranchName = (name: string): boolean => {
  if (name.length === 0 || name === RESERVED || name.startsWith('-')) {
    return false;
  }
  if (FORBIDDEN_CHARACTER.test(name) || name.includes('..') || name.includes('@{')) {
    return false;
  }
  if (name.endsWith('.') || name.endsWith('/') || name.startsWith('/')) {
    return false;
  }
  // An empty component covers both a leading slash and `a//b`; the dot and `.lock` rules are
  // per-component rather than per-name, so `a/.b` is refused while `a.b` is not.
  return name.split('/').every((component) => componentIsWellFormed(component));
};

export { isBranchName };
