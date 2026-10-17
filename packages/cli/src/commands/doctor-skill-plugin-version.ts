import { comparePlainVersions } from '@kaisers-io/refs-core';

// Which of a Codex plugin's cached version directories Codex actually loads. Codex keeps one
// directory per installed version under `<codex home>/plugins/cache/<marketplace>/<plugin>/` and
// loads exactly one of them; the others are inert. `refs doctor` used to check every directory it
// found there, so a leftover copy Codex never reads could raise a warning while the copy it does
// read went unremarked.
//
// This mirrors `active_plugin_version` in Codex 0.163.0's `core-plugin-common/src/installed.rs`:
// keep the directory names that pass Codex's version-segment rule, prefer `local` when present,
// otherwise take the greatest. Codex orders two names that both parse as semver by semver and
// anything else lexically. Here plain `x.y.z` pairs go through `comparePlainVersions` and every
// other pair compares lexically, which agrees with Codex on every version this repository
// publishes. Known divergence: a semver prerelease or build suffix (`1.0.0-rc.1`) sorts lexically
// here, where Codex ranks it below the release. Plugin versions here are release versions, and the
// cost of the divergence is checking a different leftover copy, never inventing one.

const DEFAULT_PLUGIN_VERSION = 'local';
const LESS = -1;
const EQUAL = 0;
const GREATER = 1;
const VERSION_SEGMENT_PATTERN = /^[\w.+-]+$/u;

const isVersionSegment = (name: string): boolean =>
  name !== '.' && name !== '..' && VERSION_SEGMENT_PATTERN.test(name);

const compareCodexVersions = (left: string, right: string): number => {
  const plain = comparePlainVersions(left, right);
  if (plain !== undefined) {
    return plain;
  }
  if (left === right) {
    return EQUAL;
  }
  return left < right ? LESS : GREATER;
};

/** The version directory Codex loads, or none when no name qualifies. */
const activeCodexPluginVersionOf = (names: readonly string[]): string | undefined => {
  const versions = names.filter((name) => isVersionSegment(name));
  if (versions.includes(DEFAULT_PLUGIN_VERSION)) {
    return DEFAULT_PLUGIN_VERSION;
  }
  return versions.toSorted((left, right) => compareCodexVersions(right, left))[0];
};

export { activeCodexPluginVersionOf };
