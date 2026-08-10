# Brand assets

Only `logo-wordmark-horizontal.svg` is referenced by anything, namely the README header. The rest are
kept on purpose: this is the brand set, not a build input. Nothing imports these files and no
check reads them, so they are safe to add to and safe to leave alone.

| Family | Shape | Use |
| --- | --- | --- |
| `logo-wordmark-horizontal` | 542 × 150 | wide placements such as the README header |
| `logo-wordmark-stacked` | 390 × 419 | roughly square placements where the horizontal lockup would have to shrink to stay in frame |
| `logo-monogram` | 390 × 393 | avatars, favicons, anything too small for a legible wordmark |

Each family has four files: `.svg` and `.png`, each in a plain and a `-canvas` variant. The
`-canvas` files hold the same artwork set in a 600 × 600 square with padding around it, for
placements that crop to a square or sit the mark on their own background, such as an org avatar
or a social card. The wordmarks sit dead centre there; the monogram is a few units off, centred by
eye rather than by arithmetic, which is what a tilted mark needs. The plain files are trimmed
to the artwork itself.

The SVGs are the source of truth. The PNGs are exports for contexts that will not take vector
art, and should be re-exported rather than edited.
