# Screenshots

Images used by the READMEs.

Which form to reference them with depends on the file.

The root `README.md` is only ever read on GitHub, so a relative path is right there:

```markdown
![what the picture shows](assets/screenshots/<file>.png)
```

It resolves against whatever ref the reader is on, so a picture added on a branch renders in the
pull request. An absolute URL pinned to `main` does not: it 404s until the branch is merged, which
looks like a broken image in exactly the review where somebody would have caught a bad one.

`packages/cli/README.md` is the npm package page and needs the absolute form:

```markdown
![what the picture shows](https://raw.githubusercontent.com/kaisers-io/refs/main/assets/screenshots/<file>.png)
```

The package ships only `bin`, `dist` and the changelog, so a relative path resolves to nothing
there.

Run them through `oxipng -o max --strip safe` before committing. It is lossless, and on the ones
here it halved 5.0 MB to 2.6 MB without touching a pixel: the scanline filters are rechosen and
`eXIf`, `iTXt` and `iDOT` go, while `iCCP` and `cICP` stay, so the colours are the ones the screen
showed. Keep the full resolution. Downscaled to 1600px they render blurred in a two-column table.

Keep them few. A screenshot records a model version, a CLI version and a terminal theme, and nothing tests it, so it goes stale without anyone noticing. Prose can be run against the tool; a picture cannot. Use one where the picture shows something prose cannot, such as a rendered diagram.
