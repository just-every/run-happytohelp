import {hashToken} from '../../platform/auth'
import {formerTeammate} from './erasure'

/** bs_team keeps an opaque, inactive binding as the durable re-invitation frontier.
 * No personal address is needed to refuse a stale email-only Business document.
 * The signed invite counter still authorizes an explicit fresh invitation.
 */
export async function memberBusinessErasure(db:D1Database,projectId:string,userId:string){
 const user=await db.prepare('SELECT email FROM users WHERE id=?').bind(userId).first<{email:string}>()
 if(!user)return []
 const rows=await db.prepare('SELECT email,business_id FROM bs_team WHERE operator_id=?').bind(userId).all<{email:string;business_id:string|null}>()
 const linked='EXISTS(SELECT 1 FROM h2h_business_project WHERE singleton=1 AND project_id=?1)'
 const marker='erased:'+await hashToken(user.email.toLowerCase())
 const identities=JSON.stringify([...new Set([user.email.toLowerCase(),...rows.results.map(row=>row.email.toLowerCase())])])
 const statements=[db.prepare(`UPDATE bs_settings SET document=json_set(document,'$.team',json((SELECT json_group_array(
  CASE WHEN lower(json_extract(m.value,'$.email')) IN (SELECT value FROM json_each(?3))
   OR json_extract(m.value,'$.id') IN (SELECT business_id FROM bs_team WHERE operator_id=?2 AND business_id IS NOT NULL)
  THEN json_set(m.value,'$.name',?4,'$.email',?5) ELSE json(m.value) END) FROM json_each(document,'$.team') m)))
  WHERE ${linked} AND json_type(document,'$.team')='array'`).bind(projectId,userId,identities,formerTeammate,marker)]
 for(const row of rows.results){
  const key='erased:'+await hashToken(row.email.toLowerCase())
  statements.push(db.prepare(`UPDATE bs_team SET email=?4,state='inactive' WHERE ${linked} AND operator_id=?2 AND email=?3`).bind(projectId,userId,row.email,key))
 }
 // Native-only members also leave an opaque email fence. invite=0 is the
 // unsigned initial frontier; a later explicit Business invite may create anew.
 if(!rows.results.length)statements.push(db.prepare(`INSERT INTO bs_team(email,operator_id,invite,state) SELECT ?3,?2,0,'inactive' WHERE ${linked} ON CONFLICT(email) DO NOTHING`).bind(projectId,userId,marker))
 return statements
}
