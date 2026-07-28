// Regex for parsing pnpm-workspace.yaml list items. No end-of-line anchor, so an inline
// comment (`- packages/* # comment`) still matches; the capture is trimmed afterwards.
const LIST_ITEM_PATTERN = /^\s*-\s+["']?(?<pattern>[^"'#]+)["']?/u;

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

// Sentinel deliberately distinct from every possible pattern string — a list item literally
// named "end-of-section" must still be collected, never misread as the section ending.
const END_OF_SECTION = Symbol('end-of-section');

const NO_HEADER_FOUND = -1;
const FIRST_SECTION_LINE_OFFSET = 1;

// Classifies one line inside the `packages:` section: END_OF_SECTION for a non-list `key:` line,
// the trimmed pattern for a list item, or `undefined` for a line to skip (blank lines, comments,
// list items without a usable pattern).
const consumeSectionLine = (line: string): string | typeof END_OF_SECTION | undefined => {
  const trimmed = line.trim();
  // A repeated column-0 `packages:` header re-opens the already-open section (a no-op), so only
  // any OTHER non-list `key:` line ends the section.
  if (
    trimmed &&
    !trimmed.startsWith('-') &&
    trimmed.includes(':') &&
    !PACKAGES_HEADER_PATTERN.test(line)
  ) {
    return END_OF_SECTION;
  }
  if (!trimmed.startsWith('-')) {
    return undefined;
  }
  const patternValue = LIST_ITEM_PATTERN.exec(line)?.groups?.['pattern']?.trim();
  if (patternValue) {
    return patternValue;
  }
  return undefined;
};

// Collects the patterns from the lines after the `packages:` header, stopping at the line that
// ends the section.
const collectSectionPatterns = (sectionLines: string[]): string[] => {
  const patterns: string[] = [];
  for (const line of sectionLines) {
    const consumed = consumeSectionLine(line);
    if (consumed === END_OF_SECTION) {
      break;
    }
    if (consumed !== undefined) {
      patterns.push(consumed);
    }
  }
  return patterns;
};

// Build list of patterns in packages section
const collectPnpmPatterns = (lines: string[]): string[] => {
  // Tested against the untrimmed line so only a column-0 `packages:` key opens the
  // section; an indented `packages:` (e.g. nested under `catalog:`) must not.
  const headerIndex = lines.findIndex((line) => PACKAGES_HEADER_PATTERN.test(line));
  if (headerIndex === NO_HEADER_FOUND) {
    return [];
  }
  return collectSectionPatterns(lines.slice(headerIndex + FIRST_SECTION_LINE_OFFSET));
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
