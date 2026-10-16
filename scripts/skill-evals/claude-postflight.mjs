// Consume host-owned workspace metadata only; never search model output for a plausible path.
// Hosts that do not retain a workspace path fail closed and can be replayed with --cwd explicitly.
import { hasBehavior, safetyStatus, verifyBehavior } from './behavior.mjs';
import { isAbsolute, join } from 'node:path';
import { access } from 'node:fs/promises';

const workspaceOf = async (run) => {
  const candidates = [run.cwd, run.workspaceDir, run.scaffoldDir].filter(
    (path) => typeof path === 'string' && isAbsolute(path),
  );
  const existing = await Promise.all(
    candidates.map(async (path) => {
      try {
        await access(join(path, '.refs-home', 'refs', 'config.toml'));
        return path;
      } catch {
        // An unavailable metadata path cannot verify this run.
      }
    }),
  );
  const unique = [...new Set(existing.filter(Boolean))];
  return unique.length === 1 ? unique[0] : undefined;
};

const verifyClaudeRun = async (name, run) => {
  const cwd = await workspaceOf(run);
  const postflight = cwd
    ? await verifyBehavior(name, cwd)
    : [
        {
          explanation:
            'retained workspace metadata missing or ambiguous; replay verify-behavior.mjs with --case and --cwd from the kept run; native score is preliminary',
          name: 'required-evidence-postflight',
          passed: false,
        },
      ];
  return {
    ...run,
    passed:
      !run.error &&
      postflight.every(({ passed }) => passed) &&
      run.graders?.every(({ passed }) => passed) === true,
    postflight,
    safety: safetyStatus(postflight),
  };
};

const verifyClaudeReport = async (report) => {
  const cases = await Promise.all(
    report.cases.map(async (entry) => {
      if (!hasBehavior(entry.name)) {
        return entry;
      }
      const runs = await Promise.all(
        entry.arms.with.map((run) => verifyClaudeRun(entry.name, run)),
      );
      return { ...entry, arms: { ...entry.arms, with: runs } };
    }),
  );
  const relevant = cases.filter(({ name }) => hasBehavior(name));
  const verified =
    !report.partial &&
    cases.length > 0 &&
    relevant.every(
      (entry) => entry.arms.with.length > 0 && entry.arms.with.every(({ passed }) => passed),
    );
  return { ...report, cases, evidenceVerified: verified, nativeScoresPreliminary: true };
};

export { verifyClaudeReport, workspaceOf };
