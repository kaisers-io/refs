// Shared result shape for every `refs doctor` check — kept in its own file (rather than living in
// `doctor.ts`) purely to let every `doctor-checks-*.ts` helper module import it without creating a
// circular value/type import back onto the orchestrator module itself.

type CheckStatus = 'fail' | 'ok' | 'warn';

type CheckResult = {
  detail: string;
  name: string;
  status: CheckStatus;
};

export type { CheckResult, CheckStatus };
