import {Hono} from 'hono'
import {version} from '../../../../package.json'
import type {AppEnv} from '../../../platform/env'
import {configuration,sign,verify} from './envelope'
import {anchorState,firstOwner,firstOwnerPredicate} from './first-owner'
import {browserOrigin,generation,guarded,isRandom,json,keyHash,refuse} from './common'
import {audit,authority,create,ipLimit,limit,type RequestRow} from './store'
export const platformRecovery=new Hono<AppEnv>()
platformRecovery.post('/custody',async c=>{
 await ipLimit(c)
 const payload=await verify(c.env,await json(c),'custody-request'),config=configuration(c.env),db=c.env.DB
 if(c.req.header('Origin')&&c.req.header('Origin')!==config.platform)refuse()
 const current=await db.prepare('SELECT watermark FROM identity_recovery_authority WHERE singleton=1').first<{watermark:number}>()
 if(!current||Number(payload.generation)<current.watermark)refuse(409,'recovery_generation_revoked')
 const now=Math.floor(Date.now()/1000),anchor=await anchorState(c.env)
 const predicate={sql:`EXISTS(SELECT 1 FROM identity_recovery_authority WHERE singleton=1 AND watermark<=?) AND NOT EXISTS(SELECT 1 FROM identity_recovery_nonces WHERE nonce=?)`,args:[payload.generation,payload.nonce]}
 await guarded(db,predicate,[
  db.prepare('INSERT INTO identity_recovery_nonces VALUES(?,?)').bind(payload.nonce,payload.exp),
  ...(payload.op==='status'?[]:[db.prepare(`UPDATE identity_recovery_authority SET watermark=max(watermark,?),acknowledged_generation=? WHERE singleton=1`).bind(Number(payload.generation)+(payload.op==='revoke'?1:0),payload.op==='revoke'?null:payload.generation)]),
  ...(payload.op==='revoke'?[db.prepare("UPDATE identity_recovery_requests SET state='cancelled',pending_secret=NULL,passkey_challenge=NULL WHERE mode IN ('managed','manual') AND generation<=? AND state IN ('pending','authorized')").bind(payload.generation)]:[]),
 ])
 await audit(c.env,'custody',String(payload.op))
 const state=await db.prepare('SELECT watermark FROM identity_recovery_authority WHERE singleton=1').first<{watermark:number}>()
 return c.json(await sign(c.env,{v:1,type:'custody-ack',iss:String(payload.aud),aud:String(payload.iss),installation_id:config.installation,app_id:'happytohelp',environment:'production',op:payload.op,generation:payload.generation,nonce:payload.nonce,anchor:anchor.anchor,watermark:state!.watermark,app_version:version,iat:now,exp:Math.min(Number(payload.exp),now+120)}))
})
platformRecovery.post('/challenge',async c=>{
 browserOrigin(c);await ipLimit(c);await limit(c,'installation:issue',5)
 const config=configuration(c.env),body=await json(c);if(!isRandom(body?.nonce))refuse(400)
 const owner=await firstOwner(c.env),now=Math.floor(Date.now()/1000)
 const predicate=firstOwnerPredicate(c.env,owner.user_id,owner.project_id)
 const {row}=await create(c,{mode:'managed',userId:owner.user_id,projectId:owner.project_id,nonce:body.nonce,challengeExp:now+300,predicate:{sql:`(${predicate.sql}) AND EXISTS(SELECT 1 FROM identity_recovery_authority WHERE singleton=1 AND watermark<=? AND acknowledged_generation=?)`,args:[...predicate.args,config.generation,config.generation]}})
 const challenge=await sign(c.env,{v:1,type:'app-challenge',iss:config.app,aud:`${config.platform}/api/installations/${config.installation}/owner-recovery`,installation_id:config.installation,app_id:'happytohelp',environment:'production',app_origin:config.app,owner_id:owner.user_id,workspace_id:owner.project_id,challenge_id:row.id,nonce:body.nonce,generation:config.generation,iat:now,exp:now+300})
 return c.json({requestId:row.id,challenge,platformOrigin:config.platform,installationId:config.installation,platformUrl:`${config.platform}/apps/${encodeURIComponent(config.installation)}/settings/app-settings`,expiresAt:row.expires_at},201)
})
platformRecovery.post('/authorize',async c=>{
 await ipLimit(c)
 const payload=await verify(c.env,await json(c),'platform-authorization'),config=configuration(c.env)
 if(c.req.header('Origin')&&c.req.header('Origin')!==config.platform)refuse()
 const row=await c.env.DB.prepare("SELECT * FROM identity_recovery_requests WHERE id=? AND mode='managed'").bind(payload.challenge_id).first<RequestRow>()
 if(!row||row.state!=='pending'||row.user_id!==payload.owner_id||row.project_id!==payload.workspace_id||row.capability_hash!==payload.nonce||row.generation!==payload.generation||Number(payload.exp)>row.challenge_exp!||row.challenge_exp!<=Math.floor(Date.now()/1000)){await audit(c.env,'refused','handoff_invalid');refuse()}
 const predicate=await authority(c.env,row)
 await guarded(c.env.DB,predicate,[c.env.DB.prepare("UPDATE identity_recovery_requests SET state='authorized',authorized_at=?,proof_id=? WHERE id=? AND state='pending'").bind(Date.now(),payload.platform_proof_id,row.id)])
 await audit(c.env,'authorized','accepted',row)
 return c.json({authorized:true})
})
