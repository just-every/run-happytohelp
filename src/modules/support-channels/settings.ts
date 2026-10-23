import {issuerGuard} from '../../platform/integration-authority'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {encryptToken} from '../integrations/secrets'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement,requestSource} from '../audit/record'
import {access,text,digest,prefix,type Provider} from './model'
export const settings=new Hono<AppEnv>()
settings.get(prefix+'/connections',async c=>{const actor=await access(c,'integrations.install');const rows=await c.env.DB.prepare('SELECT id,provider,account,sender,channels_json,registered,revoked_at FROM support_channel_connections WHERE project_id=? ORDER BY created_at').bind(actor.projectId).all();return c.json({data:rows.results.map(row=>({...row,webhook_url:new URL(`/api/support-channels/webhooks/${row.id}`,c.req.url).href}))})})
settings.post(prefix+'/connections',async c=>{
 const actor=await access(c,'integrations.install');await requireStepUp(c,actor,'support_channels.install')
 const guard=await issuerGuard(c.env,{actor,sessionHash:c.get('sessionHash')})
 const b=await c.req.json(),provider=text(b.provider,'provider') as Provider
 if(!['sms','whatsapp','instagram','messenger','slack'].includes(provider))throw new HTTPException(409,{message:'Teams intake is unavailable until tenant-bound Bot Framework authentication and a live scoped installation are qualified.'})
 const account=text(b.account,'provider account'),sender=text(b.sender,'sender identity'),token=text(b.token,'provider token',10000),signing=text(b.signing_secret,'signing secret',1000)
 if(provider==='sms'&&(!/^\+1\d{10}$/.test(sender)||b.registered!==true))throw new HTTPException(400,{message:'US SMS requires a +1 number and an active A2P 10DLC registration attestation. Provider registration is still independently required.'})
 if(provider==='slack'&&(!Array.isArray(b.channels)||!b.channels.length||b.channels.length>30||b.channels.some((x:unknown)=>typeof x!=='string'||!/^C[A-Z0-9]+$/.test(x))))throw new HTTPException(400,{message:'List the installed customer channel IDs explicitly'})
 const id=crypto.randomUUID(),verify=crypto.randomUUID(),now=Date.now(),cipher=await encryptToken(c.env,actor.projectId,token),secret=await encryptToken(c.env,actor.projectId,signing)
 // Reconnect rotates credentials on the SAME connection, preserving opt-out and erasure fences.
 const previous=await c.env.DB.prepare('SELECT id FROM support_channel_connections WHERE project_id=? AND provider=? AND account=? AND sender=? ORDER BY created_at DESC LIMIT 1').bind(actor.projectId,provider,account,sender).first<{id:string}>(),key=previous?.id??id
 await access(c,'integrations.install')
 const changed=await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO support_channel_connections SELECT ?,?,?,?,?,?,?,?,?,?,NULL,? WHERE EXISTS(${guard.sql}) ON CONFLICT(id) DO UPDATE SET channels_json=excluded.channels_json,token_cipher=excluded.token_cipher,signing_cipher=excluded.signing_cipher,verify_hash=excluded.verify_hash,registered=excluded.registered,revoked_at=NULL`).bind(key,actor.projectId,provider,account,sender,JSON.stringify(provider==='slack'?b.channels:[]),cipher,secret,await digest(verify),b.registered===true?1:0,now,...guard.params),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'support_channel.connected',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'support_channel',id:key},detail:{provider}},now,{sql:`EXISTS(${guard.sql})`,params:guard.params})])
 if(!changed[0].meta.changes)throw new HTTPException(409,{message:'Connection authority changed'})
 return c.json({data:{id:key,verify_token:verify,webhook_url:new URL(`/api/support-channels/webhooks/${key}`,c.req.url).href}},201)
})
settings.delete(prefix+'/connections/:id',async c=>{const actor=await access(c,'integrations.install');await requireStepUp(c,actor,'support_channels.revoke');const id=c.req.param('id')!,guard=await issuerGuard(c.env,{actor,sessionHash:c.get('sessionHash')});await c.env.DB.batch([c.env.DB.prepare(`UPDATE support_channel_connections SET revoked_at=?,token_cipher=NULL,signing_cipher=NULL WHERE id=? AND project_id=? AND EXISTS(${guard.sql})`).bind(Date.now(),id,actor.projectId,...guard.params),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'support_channel.revoked',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'support_channel',id}},Date.now(),{sql:`EXISTS(${guard.sql})`,params:guard.params})]);return c.json({revoked:true})})
