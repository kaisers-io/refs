import type { TomlError } from 'smol-toml';

// What a TOML parse failure is allowed to say. Kept out of `config-io.ts` so it can be exercised
// directly: its fail-closed half cannot be reached through the real parser.

// `TomlError.message` ends in a source excerpt: the offending line plus the nonempty lines either
// side of it. A syntax error adjacent to a ref's `url` therefore reported that url verbatim,
// credentials and all, before any schema or url handling ran — so none of the redaction elsewhere
// was reached. `line`/`column` are exposed separately, so the position survives without the source.
// The excerpt is stripped as a SUFFIX; a block that is not the suffix drops the whole message in
// favour of the coordinates, failing closed, because the point is that no source survives.
const tomlErrorSummary = (error: TomlError): string => {
  const position = `line ${String(error.line)}, column ${String(error.column)}`;
  const { codeblock, message } = error;
  if (codeblock !== '' && !message.endsWith(codeblock)) {
    return `could not be parsed (${position})`;
  }
  return `${message.slice(0, message.length - codeblock.length).trim()} (${position})`;
};

export { tomlErrorSummary };
