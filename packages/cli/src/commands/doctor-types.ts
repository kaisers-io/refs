// Shared result shape for every `refs doctor` check — kept in its own file (rather than living in
// `doctor.ts`) purely to let every `doctor-checks-*.ts` helper module import it without creating a
// circular value/type import back onto the orchestrator module itself.

type CheckStatus = 'fail' | 'ok' | 'warn';

type CheckResult = {
  detail: string;
  /** Everything the check found, for a reader that wants the list rather than the message.
   *
   * `detail` is prose, and prose has to stay readable: `config-drift` caps what it prints, because
   * a repository can legitimately declare hundreds of workspace members. Capping the JSON too
   * would make those findings unreachable — some cannot be repaired by any command, so answering
   * the ones above is not always a way to reach the rest. Present only on checks that have a list
   * worth carrying. */
  findings?: unknown[];
  name: string;
  status: CheckStatus;
};

export type { CheckResult };
