import { zRefKey, zTagFormat } from './primitives.ts';
import { z } from 'zod';

import { zPackageEntry } from './config.ts';
import { zSafePackagesRecord } from './record-keys.ts';

const MIN_LENGTH = 1;

// Partial package entry: description is optional (detected packages may lack descriptions).
// `.partial({ description: true })` is safe here because `zPackageEntry` has no `.default()`
// Fields — unlike `zSettings`, there is no default to silently reapply on an absent key (see
// The `zRefSettingsOverride` comment in config.ts for the case where `.partial()` is NOT safe).
const zPackageEntryPartial = zPackageEntry.partial({ description: true });

const zProposalBase = z.strictObject({
  default_branch: z.string().min(MIN_LENGTH),
  key: zRefKey,
  tag_format_candidate: zTagFormat.nullable(),
  url: z.string().min(MIN_LENGTH),
});

const zProposal = zProposalBase.extend({
  description: z.string().default(''),
  packages: zSafePackagesRecord(zPackageEntryPartial),
});

const zFinalProposal = zProposalBase.extend({
  description: z.string().min(MIN_LENGTH),
  packages: zSafePackagesRecord(zPackageEntry),
});

type FinalProposal = z.infer<typeof zFinalProposal>;
type Proposal = z.infer<typeof zProposal>;

export { zFinalProposal, zProposal };
export type { FinalProposal, Proposal };
