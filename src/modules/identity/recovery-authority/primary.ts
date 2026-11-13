import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {hashToken} from '../../../platform/auth'
import {verifyPassword} from '../credentials'
import {emailMode} from '../../integrations/email-provider'
import {browserOrigin,json,keyHash,keyValue,refuse} from './common'
import {firstOwner,firstOwnerPredicate} from './first-owner'
import {accountSql,audit,create,ipLimit,limit,recoveryDoor} from './store'
export const primaryRecovery=new Hono<AppEnv>()
primaryRecovery.post('/',recoveryDoor(async c=>{
 browserOrigin(c);await ipLimit(c)
 const body=await json(c),email=typeof body?.email==='string'?body.email.trim().toLowerCase().slice(0,320):''
 await limit(c,`account:${email}`,5)
 keyValue(c.env);const owner=await firstOwner(c.env)
 const credential=await c.env.DB.prepare('SELECT password_hash FROM credentials WHERE user_id=?').bind(owner.user_id).first<{password_hash:string}>()
 const offered=await hashToken(`owner-recovery-key:${typeof body.recoveryKey==='string'?body.recoveryKey.trim():''}`),expected=await keyHash(c.env)
 if(owner.email.toLowerCase()!==email||offered!==expected||!credential||!await verifyPassword(body.password,credential.password_hash)){await audit(c.env,'refused','primary_invalid',{id:crypto.randomUUID(),user_id:owner.user_id});refuse()}
 const predicate=firstOwnerPredicate(c.env,owner.user_id,owner.project_id)
 const {row,capability}=await create(c,{mode:'manual',userId:owner.user_id,projectId:owner.project_id,predicate:{sql:`(${predicate.sql}) AND EXISTS(SELECT 1 FROM credentials WHERE user_id=? AND password_hash=?) AND NOT EXISTS(SELECT 1 FROM owner_recoveries WHERE key_hash=?)`,args:[...predicate.args,owner.user_id,credential.password_hash,expected]}}).catch(async error=>{
  if(error instanceof HTTPException&&error.status===409&&await c.env.DB.prepare('SELECT 1 FROM owner_recoveries WHERE key_hash=?').bind(expected).first())await audit(c.env,'refused','key_already_used',{id:crypto.randomUUID(),user_id:owner.user_id,mode:'manual'})
  throw error
 })
 return c.json({requestId:row.id,capability,expiresAt:row.expires_at,state:'authorized'},201)
}))
primaryRecovery.post('/account/request',recoveryDoor(async c=>{
 browserOrigin(c);await ipLimit(c)
 const body=await json(c),email=typeof body?.email==='string'?body.email.trim().toLowerCase().slice(0,320):''
 await limit(c,`account:${email}`,5)
 const db=c.env.DB,user=await db.prepare('SELECT u.id,u.email,c.password_hash,(SELECT project_id FROM memberships WHERE user_id=u.id ORDER BY project_id LIMIT 1) project_id FROM users u LEFT JOIN credentials c ON c.user_id=u.id WHERE lower(u.email)=?').bind(email).first<{id:string;email:string;password_hash:string|null;project_id:string|null}>()
 const link=typeof body.primaryToken==='string'&&/^[a-f0-9]{64}$/.test(body.primaryToken)?await hashToken(body.primaryToken):null
 let token: {token_hash:string}|null=null
 if(link&&emailMode(c.env)==='remote')token=await db.prepare('SELECT token_hash FROM magic_signins WHERE token_hash=? AND user_id=? AND email=? AND consumed_at IS NULL AND expires_at>?').bind(link,user?.id??'',user?.email??'',Date.now()).first()
 const password=Boolean(user?.password_hash&&await verifyPassword(body.password,user.password_hash))
 if(!user?.project_id||(!password&&!token)){await audit(c.env,'refused','primary_invalid');refuse()}
 const proofSql=token?`EXISTS(SELECT 1 FROM magic_signins t JOIN users u ON u.id=t.user_id AND u.email=t.email WHERE t.token_hash=? AND t.user_id=? AND t.email=? AND t.consumed_at IS NULL AND t.expires_at>unixepoch('subsec')*1000)`:`EXISTS(SELECT 1 FROM credentials WHERE user_id=? AND password_hash=?)`
 const {row,capability}=await create(c,{mode:'account',userId:user.id,projectId:user.project_id,predicate:{sql:`EXISTS(SELECT 1 FROM (SELECT ? user_id) r WHERE ${accountSql}) AND ${proofSql}`,args:[user.id,...(token?[link,user.id,user.email]:[user.id,user.password_hash])]},extra:token?[db.prepare('UPDATE magic_signins SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL').bind(Date.now(),link)]:[]})
 return c.json({requestId:row.id,capability,expiresAt:row.expires_at,state:'authorized'},201)
}))
