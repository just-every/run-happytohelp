import {Hono} from 'hono'
import type {AppEnv} from '../../../platform/env'
import {requireActor} from '../../../platform/auth'
import {browserOrigin,guarded,json,refuse,type RecoveryContext} from './common'
import {accountSql,audit,epochSql,type RequestRow} from './store'
export const consentRecovery=new Hono<AppEnv>()
// The actual selected native owner session, with an actual recent factor. A
// platform role, dev admission or password/mail step-up supplies no consent.
async function reviewer(c:RecoveryContext,id:unknown){
 browserOrigin(c)
 const actor=await requireActor(c)
 if(actor.role!=='owner'||!actor.security?.factorAt||!['totp','webauthn','recovery'].includes(actor.security.factorMethod||'')||actor.security.factorAt<Date.now()-900000)refuse()
 const row=await c.env.DB.prepare(`SELECT r.* FROM identity_recovery_requests r JOIN memberships target ON target.user_id=r.user_id AND target.project_id=? WHERE r.id=? AND r.mode='account' AND r.state='authorized' AND r.expires_at>? AND r.user_id<>? AND ${epochSql} AND ${accountSql}`).bind(actor.projectId,typeof id==='string'?id:'',Date.now(),actor.id).first<RequestRow>()
 if(!row)refuse()
 return {row,actor}
}
consentRecovery.get('/account/review',async c=>{
 const {row,actor}=await reviewer(c,c.req.query('requestId'))
 const target=await c.env.DB.prepare('SELECT name,email FROM users WHERE id=?').bind(row.user_id).first<{name:string;email:string}>()
 const workspace=await c.env.DB.prepare('SELECT name FROM projects WHERE id=?').bind(actor.projectId).first<{name:string}>()
 return c.json({requestId:row.id,target,workspace:workspace?.name,expiresAt:row.expires_at})
})
consentRecovery.post('/account/approve',async c=>{
 const body=await json(c),{row,actor}=await reviewer(c,body.requestId),db=c.env.DB
 await guarded(db,{sql:`EXISTS(SELECT 1 FROM identity_recovery_requests r WHERE r.id=? AND r.state='authorized' AND r.expires_at>unixepoch('subsec')*1000 AND ${epochSql} AND ${accountSql}) AND EXISTS(SELECT 1 FROM sessions s JOIN memberships m ON m.user_id=s.actor_id AND m.project_id=s.project_id JOIN session_factors sf ON sf.token_hash=s.token_hash WHERE s.token_hash=? AND s.actor_id=? AND s.project_id=? AND s.role='owner' AND m.role='owner' AND s.revoked_at IS NULL AND s.expires_at>unixepoch('subsec')*1000 AND sf.verified_at=? AND sf.verified_at>unixepoch('subsec')*1000-900000 AND sf.method IN ('totp','webauthn','recovery'))`,args:[row.id,c.get('sessionHash'),actor.id,actor.projectId,actor.security!.factorAt]},[
  db.prepare('INSERT INTO identity_recovery_approvals VALUES(?,?,?,?,?,coalesce((SELECT epoch FROM identity_recovery_epochs WHERE user_id=?),0)) ON CONFLICT(request_id,project_id) DO UPDATE SET user_id=excluded.user_id,session_hash=excluded.session_hash,factor_at=excluded.factor_at,approver_epoch=excluded.approver_epoch').bind(row.id,actor.projectId,actor.id,c.get('sessionHash'),actor.security!.factorAt,actor.id),
 ])
 await audit(c.env,'approved','accepted',row)
 return c.json({approved:true})
})
