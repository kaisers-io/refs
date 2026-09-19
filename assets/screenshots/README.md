# Screenshots

Images used by the READMEs.

Reference them with an absolute URL, not a relative path:

```markdown
![what the picture shows](https://raw.githubusercontent.com/kaisers-io/refs/main/assets/screenshots/<file>.png)
```

The npm package ships only `bin`, `dist` and the changelog, so a relative path resolves to nothing on the package page. An absolute URL renders in both places.

Keep them few. A screenshot records a model version, a CLI version and a terminal theme, and nothing tests it, so it goes stale without anyone noticing. Prose can be run against the tool; a picture cannot. Use one where the picture shows something prose cannot, such as a rendered diagram.
