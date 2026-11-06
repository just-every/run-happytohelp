import type {WaveBinding,WaveCensus,WaveDescriptor} from './base-types'
import type {ImportGrantQuotas} from '../door/grants'

/** Required trusted destination integration, NOT an executor request or verdict.
 * Base c053's public wave-status does not export this descriptor/comparison view.
 * HH f2cc's package reader does not implement ImportDoorBoundedSource. Until the
 * actual adopter supplies both, Business refuses execution review and grants. */
export interface DestinationReviewInventory {
 binding:WaveBinding
 parentId:string
 fingerprint:string
 installationId:string
 destination:string
 namespace:string
 owner:string
 previousCompleteHead:string|null
 census:WaveCensus
 children:WaveDescriptor[]
 /** Global changes against the prior complete baseline. Exclusion counts name
  * changed entries requiring a proposal; unchanged, already-explained custody
  * stays in dispositions. The qualified native reader owns that comparison. */
 comparison:{baselineSource:number;additions:number;replacements:number;gone:number;rejected:number;unmapped:number;conflicts:number;fingerprint:string}
 dispositions:{mapped:number;rejected:number;explained:number;reused:number}
 goneButRetained:{kind:string;sourceId:string}[]
 limits:ImportGrantQuotas
}
/** A separate migration judgment, never the classify-row money ledger. All
 * complete/global comparison evidence, current authority and immutable input
 * fingerprints must be bound BEFORE any out-of-bounds child apply approval.
 * This interface does not install a judge or manufacture an allow verdict. */
export interface IndependentMigrationJudgment {
 decisionId:string
 judgeAgentId:string
 requestingAgentId:string
 reviewFingerprint:string
 evidenceFingerprint:string
 authorityFingerprint:string
 policyRevision:string
 verdict:'allow'|'refuse'
 decidedAt:string
 expiresAt:string
}
export interface BoundedDestinationIntegration {
 /** Read the actual sealed inventory under current claimed installation authority. */
 review(binding:Readonly<WaveBinding>,parentId:string):Promise<DestinationReviewInventory>
 /** Destination current same-database approval installation is owed, not a
  * cached boolean or a Business-only approval that the native engine ignores. */
 currentAuthority(binding:Readonly<WaveBinding>,action:string):{sql:string;params?:unknown[]}
 /** Install signed Business approval under the CURRENT destination claim, and
  * read its actual same-database predicate/approval back. No task assertion is
  * accepted as an installation receipt. The destination adopter owns this. */
 installApproval(envelope:BoundedApprovalEnvelope):Promise<BoundedApprovalInstallation>
 approvalCurrent(envelope:BoundedApprovalEnvelope,action:string):Promise<BoundedApprovalInstallation>
 revokeApproval(envelope:BoundedApprovalEnvelope):Promise<{approvalId:string;revoked:true}>
}
export interface BoundedApprovalEnvelope {
 id:string;businessId:string;taskId:string;installationId:string;destination:string;namespace:string;owner:string
 parentId:string;parentFingerprint:string;ordinal:number;fingerprint:string;binding:WaveBinding
 agentId:string;authorityFingerprint:string;approvedAt:string;expiresAt:string;signature:string
}
export interface BoundedApprovalInstallation {
 approvalId:string;installationId:string;parentId:string;ordinal:number;fingerprint:string
 authorityFingerprint:string;current:true
}
