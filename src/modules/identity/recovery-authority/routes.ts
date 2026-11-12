import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {platformRecovery} from './platform'
import {primaryRecovery} from './primary'
import {consentRecovery} from './consent'
import {enrolmentRecovery} from './enrolment'
import {browserOrigin,refuse} from './common'
import {accountSql,approvalsSql,currentApprovalSql,audit,authority,cleanup,load} from './store'
export const recoveryAuthority=new Hono<AppEnv>()
recoveryAuthority.use('*',async(c,next)=>{c.header('Cache-Control','no-store');await cleanup(c.env);await next()})
recoveryAuthority.route('/',platformRecovery)
recoveryAuthority.route('/',primaryRecovery)
recoveryAuthority.route('/',consentRecovery)
recoveryAuthority.route('/',enrolmentRecovery)
recoveryAuthority.get('/status',async c=>{
 browserOrigin(c);const row=await load(c)
 let valid=false
 if(['pending','authorized'].includes(row.state)){try{const predicate=await authority(c.env,row);valid=Boolean(await c.env.DB.prepare(`SELECT 1 WHERE ${predicate.sql}`).bind(...predicate.args).first())}catch(error){if(error instanceof HTTPException&&[403,503].includes(error.status))valid=false;else throw error}}
 const counts=row.mode==='account'?await c.env.DB.prepare(`SELECT (SELECT count(*) FROM memberships WHERE user_id=r.user_id) required,(SELECT count(*) FROM memberships target WHERE target.user_id=r.user_id AND (${currentApprovalSql})) approved,(${approvalsSql}) ready FROM identity_recovery_requests r WHERE r.id=? AND ${accountSql}`).bind(row.id).first<{required:number;approved:number;ready:number}>():null
 const needsPassword=!await c.env.DB.prepare('SELECT 1 FROM credentials WHERE user_id=?').bind(row.user_id).first()
 return c.json({requestId:row.id,state:['completed','cancelled','expired','refused'].includes(row.state)?row.state:valid?row.state:'refused',expiresAt:row.state==='pending'?row.challenge_exp!*1000:row.expires_at,mode:row.mode,approved:valid?(counts?.approved??0):0,required:valid?(counts?.required??0):0,ready:valid&&row.state==='authorized'&&(row.mode!=='account'||Boolean(counts?.ready)),needsPassword})
})
recoveryAuthority.post('/cancel',async c=>{
 browserOrigin(c);const row=await load(c)
 if(!['pending','authorized'].includes(row.state))refuse(409)
 const cancelled=await c.env.DB.prepare("UPDATE identity_recovery_requests SET state='cancelled',pending_secret=NULL,passkey_challenge=NULL WHERE id=? AND state IN ('pending','authorized') RETURNING id").bind(row.id).first()
 if(!cancelled)refuse(409)
 await audit(c.env,'cancelled','accepted',row)
 return c.json({cancelled:true})
})
