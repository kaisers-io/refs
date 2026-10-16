// Reads one grader out of an eval case's case.yaml, for tests that pin a case's own patterns.
//
// Just enough YAML for the suite's grader entries: plain and single-quoted scalars, numbers and a
// one-line `{ source: file, path: … }` mapping. The CI job that runs these tests has no install,
// so a YAML library is not an option. An entry this cannot read fails loudly in the caller.

import { readFile } from 'node:fs/promises';

const FIELD = /^ {4}(?<key>type|pattern|flags|match|target|tool|input_match|min|max): (?<value>.*)$/u;
const NUMERIC = new Set(['max', 'min']);

const scalar = (raw) => {
  const quoted = /^'(?<body>.*)'$/su.exec(raw)?.groups.body;
  return quoted === undefined ? raw.trim() : quoted.replaceAll("''", "'");
};

const targetOf = (raw) => {
  const path = /path: (?<path>[^ }]+)/u.exec(raw)?.groups.path;
  return path === undefined ? scalar(raw) : { path, source: 'file' };
};

const valueOf = (key, raw) => {
  if (key === 'target') {
    return targetOf(raw);
  }
  return NUMERIC.has(key) ? Number(raw) : scalar(raw);
};

const fieldOf = (line) => {
  const field = FIELD.exec(line)?.groups;
  return field === undefined ? {} : { [field.key]: valueOf(field.key, field.value) };
};

const NOT_FOUND = -1;

/** The lines of the entry `  - name: <name>`, without the name line itself. */
const entryLines = (text, caseName, name) => {
  const lines = text.split('\n');
  const index = lines.indexOf(`  - name: ${name}`);
  if (index === NOT_FOUND) {
    throw new Error(`${caseName} has no grader ${name}`);
  }
  const body = lines.slice(index + 1);
  const length = body.findIndex((line) => !line.startsWith('    '));
  return body.slice(0, length);
};

/** The grader called `name` in evals/<caseName>/case.yaml, or a thrown error naming what is
 * missing — a test must never run against a grader that was not found. */
const graderFrom = async (caseName, name) => {
  const url = new URL(`../../evals/${caseName}/case.yaml`, import.meta.url);
  const text = await readFile(url, 'utf8');
  const grader = { name };
  for (const line of entryLines(text, caseName, name)) {
    Object.assign(grader, fieldOf(line));
  }
  if (typeof (grader.pattern ?? grader.input_match) !== 'string') {
    throw new TypeError(`${caseName}: grader ${name} has neither a pattern nor an input_match`);
  }
  return grader;
};

export { graderFrom };
