import {emailDigest} from '../../vendor/agent-base/modules/business-settings/retire.ts'

/** Erasing a teammate who is on the Business roster is the agent door's job: its erasure batch
 * (agentErasureStatements, declaring agent_door_state with retire.refs 'operatorPolicyRefs') deletes their
 * bs_team row, drops them from the stored settings document and writes the value-free bs_retired tombstone that
 * keeps the Business's next revision from re-creating them. This adds only the tombstone for a teammate the
 * Business never listed: erased means gone until the Business sends an explicit larger invite number, and
 * invite 0 is the unsigned initial frontier. No personal address is stored; the digest is value-free.
 */
export async function memberBusinessErasure(db:D1Database,projectId:string,userId:string,erasureId:string){
 const user=await db.prepare('SELECT email FROM users WHERE id=?').bind(userId).first<{email:string}>()
 if(!user||await db.prepare('SELECT 1 FROM bs_team WHERE operator_id=?').bind(userId).first())return []
 return [db.prepare(`INSERT INTO bs_retired(digest,invite,erasure_id) SELECT ?3,0,?4 WHERE EXISTS(SELECT 1 FROM h2h_business_project WHERE singleton=1 AND project_id=?1)
  ON CONFLICT(digest) DO NOTHING`).bind(projectId,userId,await emailDigest(user.email),erasureId)]
}
