import { EXIT, resolveHome } from '@kaisers-io/refs-core';
import type { RefsHome, State } from '@kaisers-io/refs-core';
import {
  buildConfigCheck,
  checkCliUpdate,
  checkGit,
  checkNode,
  loadConfigSafely,
} from './doctor-checks-basic.ts';
import { checkDirtyCheckouts, checkHooksGuard } from './doctor-checks-checkouts.ts';
import { checkOrphans, loadStateSafely } from './doctor-checks-orphans.ts';
import { cliOptsOf, emit, errorMessageOf, wrapAction } from '../output.ts';
import type { CheckResult } from './doctor-types.ts';
import type { CliContext } from '../context.ts';
import type { ConfigLoad } from './doctor-checks-basic.ts';
import type { RefsCommand } from './registry.ts';
import { checkSkill } from './doctor-checks-skill.ts';
import { checkSshAuth } from './doctor-checks-ssh.ts';

// `refs doctor [--json]` — the 9 environment/integrity checks: `git`, `node`,
// `config`, `hooks-guard`, `dirty-checkouts`, `orphans`, `skill`, `cli-update`, `ssh-auth` (the
// last one only ever appears when a configured ref uses an ssh transport url). Every check runs to completion
// before anything is reported — a failing `config` check must never prevent `orphans`/
// `dirty-checkouts`/etc. from still running against whatever they can determine — so the actual
// check implementations live in sibling doctor-checks-*.ts modules, grouped by
// what they touch, and are simply collected here in the order they are reported. Each
// step also carries its own `name`: an UNEXPECTED throw from one check (e.g. `orphans`' directory
// walk rethrowing a non-ENOENT `readdir` fault such as EACCES/ENOTDIR/ELOOP) must never abort the
// whole batch — `runStepSafely` below catches it and reports that one check as `fail` instead,
// exactly like any other check failure the corresponding module already handles internally.
type CheckStep = {
  name: string;
  run: () => Promise<CheckResult | undefined>;
};

/** Runs a single step, converting an unexpected throw into a `fail` result labeled with the step's
 * own `name` rather than letting it escape and abort every other check — the one property this
 * whole module exists to guarantee (see the module doc comment above). A check that returns its
 * own `fail`/`warn`/`ok` result never reaches the `catch` at all; this only ever fires for a bug or
 * an unhandled OS fault inside the check itself. */
const runStepSafely = async (step: CheckStep): Promise<CheckResult | undefined> => {
  try {
    return await step.run();
  } catch (error) {
    return { detail: `check crashed: ${errorMessageOf(error)}`, name: step.name, status: 'fail' };
  }
};

/** Runs `steps` one at a time, strictly in order — never `Promise.all`, so two checks that both
 * shell out via the same injected `Runner` (e.g. `hooks-guard`'s and `dirty-checkouts`' per-checkout
 * git calls) produce a deterministic, spec-ordered call sequence instead of an interleaving that
 * would depend on each check's own internal await shape. */
const runStepsInOrder = async (steps: readonly CheckStep[]): Promise<CheckResult[]> => {
  const [step, ...rest] = steps;
  if (step === undefined) {
    return [];
  }
  const result = await runStepSafely(step);
  const remaining = await runStepsInOrder(rest);
  if (result === undefined) {
    return remaining;
  }
  return [result, ...remaining];
};

type DoctorLoad = {
  configLoad: ConfigLoad;
  ctx: CliContext;
  home: RefsHome;
  state: State;
};

const buildCheckSteps = (load: DoctorLoad): CheckStep[] => {
  const { configLoad, ctx, home, state } = load;
  return [
    { name: 'git', run: () => checkGit(ctx) },
    { name: 'node', run: () => Promise.resolve(checkNode(ctx)) },
    { name: 'config', run: () => Promise.resolve(buildConfigCheck(configLoad.errorMessage)) },
    { name: 'hooks-guard', run: () => checkHooksGuard(ctx, home, configLoad.config) },
    { name: 'dirty-checkouts', run: () => checkDirtyCheckouts(ctx, home, configLoad.config) },
    { name: 'orphans', run: () => checkOrphans(home, configLoad.config, state) },
    { name: 'skill', run: () => checkSkill(ctx) },
    { name: 'cli-update', run: () => checkCliUpdate(ctx, configLoad.config) },
    { name: 'ssh-auth', run: () => checkSshAuth(ctx, configLoad.config) },
  ];
};

const runDoctor = async (ctx: CliContext): Promise<CheckResult[]> => {
  const home = resolveHome(ctx.env);
  const configLoad = await loadConfigSafely(home);
  const state = await loadStateSafely(home);
  return runStepsInOrder(buildCheckSteps({ configLoad, ctx, home, state }));
};

const STATUS_LABEL: Record<CheckResult['status'], string> = {
  fail: 'FAIL',
  ok: 'OK',
  warn: 'WARN',
};

const doctorHuman = (checks: readonly CheckResult[]): string[] =>
  checks.map((check) => `[${STATUS_LABEL[check.status]}] ${check.name}: ${check.detail}`);

const hasFailure = (checks: readonly CheckResult[]): boolean =>
  checks.some((check) => check.status === 'fail');

const registerDoctor = (program: RefsCommand, ctx: CliContext): void => {
  program
    .command('doctor')
    .description('Run environment/integrity checks (git, node, config, hooks, checkouts, ssh).')
    .action((_localOpts, command) => {
      const opts = cliOptsOf(command);
      return wrapAction(ctx, opts, async () => {
        const checks = await runDoctor(ctx);
        emit(ctx, opts, doctorHuman(checks), { checks });
        // `wrapAction` only sets `process.exitCode` on a THROWN error; a check reporting `fail` is
        // not one (the envelope itself is still `ok: true`, mirroring `sync.ts`'s own per-item
        // failure handling), so this is the one place that needs to set it directly.
        if (hasFailure(checks)) {
          process.exitCode = EXIT.UNEXPECTED;
        }
      })();
    });
};

export { registerDoctor };
