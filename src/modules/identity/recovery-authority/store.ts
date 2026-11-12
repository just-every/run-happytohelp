import type {Env} from '../../../platform/env'
import {hashToken} from '../../../platform/auth'
import {clientAddress} from '../../../platform/rate-limits'
import {accountAudit} from '../two-factor/factors'
import {digest,generation,guarded,isRandom,keyHash,random,refuse,type Predicate,type RecoveryContext} from './common'
import {firstOwnerPredicate} from './first-owner'
export interface RequestRow {id:string;capability_hash:string;mode:'managed'|'manual'|'account';user_id:string;project_id:string;epoch:number;generation:number;key_hash:string|null;state:string;created_at:number;expires_at:number;challenge_exp:number|null;authorized_at:number|null;proof_id:string|null;completion_id:string|null;pending_id:string|null;pending_secret:string|null;passkey_challenge:string|null;passkey_expires:number|null}
export async function audit(env:Env,action:string,reason='accepted',request?:Pick<RequestRow,'id'|'user_id'>){
 const now=Date.now()
 await env.DB.batch([env.DB.prepare('INSERT INTO identity_recovery_events VALUES(?,?,?,?,?,?)').bind(random(),request?.id??null,request?.user_id??null,action,reason,now),...(request?await accountAudit(env.DB,request.user_id,{category:'auth',action:`recovery.${action}`,outcome:reason==='accepted'?'succeeded':'refused',actor:{type:'installation'},source:'api',target:{type:'recovery',id:request.id},detail:{reason}}):[])])
}
export async function cleanup(env:Env){
 const now=Date.now(),db=env.DB
 const expired=(await db.prepare("SELECT id,user_id FROM identity_recovery_requests WHERE expires_at<=? AND state IN ('pending','authorized') ORDER BY expires_at LIMIT 20").bind(now).all<Pick<RequestRow,'id'|'user_id'>>()).results
 for(const row of expired)await audit(env,'expired','expired',row)
 await db.batch([
  db.prepare("UPDATE identity_recovery_requests SET state='expired',pending_secret=NULL,passkey_challenge=NULL WHERE id IN (SELECT id FROM identity_recovery_requests WHERE expires_at<=? AND state IN ('pending','authorized') ORDER BY expires_at LIMIT 20)").bind(now),
  db.prepare('DELETE FROM identity_recovery_requests WHERE id IN (SELECT id FROM identity_recovery_requests WHERE expires_at<? ORDER BY expires_at LIMIT 20)').bind(now-3600000),
  db.prepare('DELETE FROM identity_recovery_nonces WHERE nonce IN (SELECT nonce FROM identity_recovery_nonces WHERE expires_at<? ORDER BY expires_at LIMIT 100)').bind(Math.floor(now/1000)),
  db.prepare('DELETE FROM identity_recovery_limits WHERE key IN (SELECT key FROM identity_recovery_limits WHERE window_start<? ORDER BY window_start LIMIT 100)').bind(now-3600000),
 ])
}
export async function limit(c:RecoveryContext,identity:string,max:number){
 const now=Date.now(),key=await hashToken(`identity-recovery:${identity}`)
 const row=await c.env.DB.prepare(`INSERT INTO identity_recovery_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start<=? THEN 1 ELSE attempts+1 END,window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END RETURNING attempts`).bind(key,now,now-3600000,now-3600000).first<{attempts:number}>()
 if(!row||row.attempts>max){await audit(c.env,'refused','rate_limited');refuse(429)}
}
export const ipLimit=(c:RecoveryContext)=>limit(c,`ip:${clientAddress(c.req)}`,30)
export const epochSql=`coalesce((SELECT epoch FROM identity_recovery_epochs WHERE user_id=r.user_id),0)=r.epoch`
export const accountSql=`NOT EXISTS(SELECT 1 FROM owner_setup WHERE singleton=1 AND claim_id=r.user_id) AND NOT EXISTS(SELECT 1 FROM platform_admins WHERE user_id=r.user_id) AND EXISTS(SELECT 1 FROM memberships WHERE user_id=r.user_id) AND NOT EXISTS(SELECT 1 FROM memberships m LEFT JOIN projects p ON p.id=m.project_id WHERE m.user_id=r.user_id AND (p.id IS NULL OR EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=p.id AND (json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL OR json_extract(ps.settings_json,'$.suspended_at') IS NOT NULL))))`
export const currentApprovalSql=`EXISTS(SELECT 1 FROM identity_recovery_approvals a JOIN sessions s ON s.token_hash=a.session_hash JOIN memberships owner ON owner.project_id=a.project_id AND owner.user_id=a.user_id AND owner.role='owner' JOIN session_factors sf ON sf.token_hash=s.token_hash AND sf.user_id=a.user_id WHERE a.request_id=r.id AND a.project_id=target.project_id AND a.user_id<>r.user_id AND a.approver_epoch=coalesce((SELECT epoch FROM identity_recovery_epochs WHERE user_id=a.user_id),0) AND s.actor_id=a.user_id AND s.project_id=a.project_id AND s.role='owner' AND s.revoked_at IS NULL AND s.expires_at>unixepoch('subsec')*1000 AND sf.verified_at=a.factor_at AND sf.verified_at>unixepoch('subsec')*1000-900000 AND sf.method IN ('totp','webauthn','recovery') AND EXISTS(SELECT 1 FROM user_factors WHERE user_id=a.user_id AND confirmed_at IS NOT NULL))`
export const approvalsSql=`NOT EXISTS(SELECT 1 FROM memberships target WHERE target.user_id=r.user_id AND NOT (${currentApprovalSql}))`
export async function authority(env:Env,row:RequestRow,complete=false):Promise<Predicate>{
 const base=`r.id=? AND r.state=? AND r.expires_at>unixepoch('subsec')*1000 AND ${epochSql} AND EXISTS(SELECT 1 FROM users WHERE id=r.user_id)`
 if(row.mode==='account')return {sql:`EXISTS(SELECT 1 FROM identity_recovery_requests r WHERE ${base} AND ${accountSql}${complete?` AND ${approvalsSql}`:''})`,args:[row.id,'authorized']}
 const owner=firstOwnerPredicate(env,row.user_id,row.project_id),key=await keyHash(env)
 return {sql:`EXISTS(SELECT 1 FROM identity_recovery_requests r JOIN identity_recovery_authority a ON a.singleton=1 WHERE ${base} AND r.generation=? AND r.generation>=a.watermark AND r.key_hash=? AND ${owner.sql} ${row.mode==='managed'?"AND a.acknowledged_generation=r.generation":"AND NOT EXISTS(SELECT 1 FROM owner_recoveries used WHERE used.key_hash=r.key_hash)"})`,args:[row.id,row.state==='pending'?'pending':'authorized',generation(env),key,...owner.args]}
}
export async function load(c:RecoveryContext){
 const secret=c.req.header('X-Recovery-Capability')||'';if(!isRandom(secret))refuse(401)
 const row=await c.env.DB.prepare('SELECT * FROM identity_recovery_requests WHERE capability_hash=?').bind(await digest(secret)).first<RequestRow>()
 if(!row)refuse(401)
 return row
}
export async function requireLive(c:RecoveryContext,complete=false){const row=await load(c);if(row.state!=='authorized')refuse(409);const predicate=await authority(c.env,row,complete);if(!await c.env.DB.prepare(`SELECT 1 WHERE ${predicate.sql}`).bind(...predicate.args).first()){await audit(c.env,'refused','authority_changed',row);refuse(409)}return {row,predicate}}
export async function create(c:RecoveryContext,input:{userId:string;projectId:string;mode:RequestRow['mode'];nonce?:string;challengeExp?:number;extra?:D1PreparedStatement[];predicate:Predicate}){
 const id=random(),capability=input.nonce?null:random(),capabilityHash=input.nonce||await digest(capability!),now=Date.now(),key=input.mode==='account'?null:await keyHash(c.env)
 const db=c.env.DB
 const result=await guarded(db,{sql:`(${input.predicate.sql}) AND (SELECT count(*) FROM identity_recovery_requests WHERE user_id=? AND expires_at>? AND state IN ('pending','authorized'))<3`,args:[...input.predicate.args,input.userId,now]},[
  ...(input.extra??[]),
  db.prepare(`INSERT INTO identity_recovery_requests(id,capability_hash,mode,user_id,project_id,epoch,generation,key_hash,state,created_at,expires_at,challenge_exp,authorized_at) VALUES(?,?,?,?,?,coalesce((SELECT epoch FROM identity_recovery_epochs WHERE user_id=?),0),?,?,?,?,?,?,?)`).bind(id,capabilityHash,input.mode,input.userId,input.projectId,input.userId,input.mode==='account'?0:generation(c.env),key,input.mode==='managed'?'pending':'authorized',now,now+900000,input.challengeExp??null,input.mode==='managed'?null:now),
 ])
 void result
 const row=await db.prepare('SELECT * FROM identity_recovery_requests WHERE id=?').bind(id).first<RequestRow>()
 await audit(c.env,'requested','accepted',row!)
 return {row:row!,capability}
}
