import { zRefKey, zTagFormat } from './primitives.ts';
import { z } from 'zod';

import { zPackageEntry } from './config.ts';
import { zSafePackagesRecord } from './record-keys.ts';

// Partial package entry: description is optional (detected packages may lack descriptions).
// `.partial({ description: true })` is safe here because `zPackageEntry` has no `.default()`
// fields — unlike `zSettings`, there is no default to silently reapply on an absent key (see
// the `zRefSettingsOverride` comment in config.ts for the case where `.partial()` is NOT safe).
const zPackageEntryPartial = zPackageEntry.partial({ description: true });

const zProposalBase = z.strictObject({
  default_branch: z.string().min(1),
  key: zRefKey,
  tag_format_candidate: zTagFormat.nullable(),
  url: z.string().min(1),
});

const zProposal = zProposalBase.extend({
  description: z.string().default(''),
  packages: zSafePackagesRecord(zPackageEntryPartial),
});

const zFinalProposal = zProposalBase.extend({
  description: z.string().min(1),
  packages: zSafePackagesRecord(zPackageEntry),
});

type FinalProposal = z.infer<typeof zFinalProposal>;
type Proposal = z.infer<typeof zProposal>;

export { zFinalProposal, zProposal };
export type { FinalProposal, Proposal };
