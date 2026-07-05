const EMPTY_STRING = '';

// Regex for parsing pnpm-workspace.yaml list items. No end-of-line anchor, so an inline
// comment (`- packages/* # comment`) still matches; the capture is trimmed afterwards.
const LIST_ITEM_PATTERN =
  // eslint-disable-next-line regexp/no-unused-capturing-group -- capture group needed for extraction
  /^\s*-\s+["']?(?<pattern>[^"'#]+)["']?/u;

// Matches the `packages:` section header, optionally followed by an inline comment
// (`packages: # workspace packages`), which is valid YAML and must still open the section.
const PACKAGES_HEADER_PATTERN = /^packages:\s*(?:#.*)?$/u;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Parse package.json workspaces field (array or {packages: []})
const parseNpmWorkspaces = (workspacesField: unknown): string[] => {
  if (Array.isArray(workspacesField)) {
    return workspacesField.filter((item): item is string => typeof item === 'string');
  }

  if (!isPlainObject(workspacesField)) {
    return [];
  }

  const { packages } = workspacesField;
  if (!Array.isArray(packages)) {
    return [];
  }

  return packages.filter((item): item is string => typeof item === 'string');
};

// Build list of patterns in packages section
// eslint-disable-next-line max-statements -- state machine for parsing YAML list, unavoidable complexity
const collectPnpmPatterns = (lines: string[]): string[] => {
  const patterns: string[] = [];
  let inPackages = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Tested against the untrimmed line so only a column-0 `packages:` key opens the
    // section; an indented `packages:` (e.g. nested under `catalog:`) must not.
    if (PACKAGES_HEADER_PATTERN.test(line)) {
      inPackages = true;
      // eslint-disable-next-line no-continue
      continue;
    }

    if (!inPackages) {
      // eslint-disable-next-line no-continue
      continue;
    }

    if (trimmed && !trimmed.startsWith('-') && trimmed.includes(':')) {
      break;
    }

    if (!trimmed.startsWith('-')) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const match = LIST_ITEM_PATTERN.exec(line);
    const patternValue = match?.groups?.['pattern']?.trim();
    if (patternValue && patternValue !== EMPTY_STRING) {
      patterns.push(patternValue);
    }
  }

  return patterns;
};

// Extract name field from package data
const extractPackageName = (data: Record<string, unknown>): string | undefined => {
  const { name } = data;
  if (typeof name === 'string') {
    return name;
  }

  return undefined;
};

// Extract description field from package data
const extractPackageDescription = (data: Record<string, unknown>): string | undefined => {
  const { description } = data;
  if (typeof description === 'string') {
    return description;
  }

  return undefined;
};

export { collectPnpmPatterns, extractPackageDescription, extractPackageName, parseNpmWorkspaces };
