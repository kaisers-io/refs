import { describe, expect, it } from 'vitest';
import { tagCandidateFrom } from '../../src/commands/add-dry-run.ts';

// A tag-format candidate is a claim about which format most of a repository's tags use. A partial
// tag list cannot support it — whichever prefix happened to survive the cut would win — so a read
// that is not whole produces no candidate at all, the same answer a repository with no usable tags
// gets. `refs tag` then reports the absence rather than resolving against an invented convention.
//
// The truncation this guards against needs git to emit more than the collector's 64 MiB stream cap,
// which no integration fixture can reach. The decision is pinned here instead of not at all.

describe('the tag-format candidate a dry-run proposes', () => {
  it('names the dominant format when the tag list was read whole', () => {
    expect.hasAssertions();

    expect(
      tagCandidateFrom({
        complete: true,
        tags: ['astro@5.0.0', 'astro@4.0.0', 'create-astro@5.0.0'],
      }),
    ).toBe('astro@{version}');
  });

  it('proposes nothing when the tag list was not read whole', () => {
    expect.hasAssertions();

    // The same tags, and a perfectly plausible answer — withheld, because the list they came from
    // is not the repository's.
    expect(
      tagCandidateFrom({
        complete: false,
        tags: ['astro@5.0.0', 'astro@4.0.0', 'create-astro@5.0.0'],
      }),
    ).toBeNull();
  });

  it('proposes nothing when a whole list yields no usable format', () => {
    expect.hasAssertions();

    expect(tagCandidateFrom({ complete: true, tags: ['nightly', 'latest'] })).toBeNull();
  });
});
