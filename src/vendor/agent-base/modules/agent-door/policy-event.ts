import { classIds } from './policy/catalogue.ts'
import { document_sha256 } from './policy/document.ts'
import type { PolicyState } from './types.ts'

/**
 * The `policy.adopted` event body: policy metadata only. `classes` names the
 * classes the adopted document has a rule for (`*` covers every class), in the
 * `{ class }` shape `approval.pending` carries, without call facts. `decision`
 * identifies the adopted revision by number and document digest. No rule,
 * reviewer, approver, threshold or spend value is carried.
 */
export async function policyAdoptedData(state: PolicyState) {
  const covered = new Set(state.document?.rules.map(rule => rule.class))
  return {
    seq: state.seq, revision: state.revision,
    classes: classIds.filter(cls => covered.has('*') || covered.has(cls)).map(cls => ({ class: cls })),
    decision: { revision: state.revision, document_sha256: state.document ? await document_sha256(state.document) : null },
  }
}
