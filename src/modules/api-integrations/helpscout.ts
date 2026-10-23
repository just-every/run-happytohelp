import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {encryptToken,decryptToken} from '../integrations/secrets'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement,requestSource} from '../audit/record'
import {helpScoutActor,helpScoutBytes} from './helpscout-authority'
import {helpScoutId,helpScoutReader} from './helpscout-provider'

import {getHelpScout as get,helpScoutView as view} from './helpscout-store'
import {helpScoutMerges} from './helpscout-merge'
import {syncHelpScout} from './helpscout-sync'
const secret=(value:unknown)=>{if(typeof value!=='string'||value.length<16||value.length>4096||/[\r\n\x00]/.test(value))throw new HTTPException(400,{message:'A private provider credential is required'});return value}
export const helpScoutSettings=new Hono<AppEnv>(),helpScoutEvents=new Hono<AppEnv>()
const root='/projects/:projectId/connections/helpscout'
helpScoutMerges(helpScoutSettings,root)

helpScoutSettings.get(root,async c=>{
 const {actor}=await helpScoutActor(c,'data.import'),row=await get(c.env.DB,actor.project_id)
 const receipts=await c.env.DB.prepare('SELECT r.run_id,r.created_at,m.state,x.merged_at,x.messages,x.notes FROM helpscout_sync_receipts r JOIN move_in_runs m ON m.id=r.run_id LEFT JOIN helpscout_merge_receipts x ON x.run_id=r.run_id AND x.project_id=r.project_id WHERE r.project_id=? ORDER BY r.created_at DESC,r.run_id LIMIT 100').bind(actor.project_id).all()
 return c.json({data:view(row),attempts:receipts.results})
})
helpScoutSettings.post(root,async c=>{
 const {actor,batch}=await helpScoutActor(c,'integrations.install');await requireStepUp(c,c.get('actor'),'integration.install')
 let body:any;try{body=JSON.parse(new TextDecoder().decode(await helpScoutBytes(c.req.raw,16384)))}catch(error){if(error instanceof HTTPException)throw error;throw new HTTPException(400,{message:'JSON connection settings required'})}
 if(body?.continuous!==undefined&&typeof body.continuous!=='boolean')throw new HTTPException(400,{message:'continuous must be a boolean'})
 if(body?.continuous)await helpScoutActor(c,'data.import')
 const mailbox=helpScoutId(body?.mailboxId),token=secret(body?.accessToken),webhook=secret(body?.webhookSecret),prior=await get(c.env.DB,actor.project_id)
 if(prior&&prior.mailbox_id!==mailbox)throw new HTTPException(409,{message:'Reconnect the original Help Scout mailbox; use a separate workspace for another mailbox'})
 const start=prior?.cursor??body?.startFrom
 if(typeof start!=='string'||!Number.isFinite(Date.parse(start))||Date.parse(start)>Date.now())throw new HTTPException(400,{message:'Choose a valid past startFrom timestamp'})
 const provider=await helpScoutReader(token)('/v2/mailboxes/'+mailbox)
 if(String(provider.id)!==mailbox)throw new HTTPException(502,{message:'helpscout_mailbox_scope_invalid'})
 const [tokenCipher,webhookCipher]=await Promise.all([encryptToken(c.env,actor.project_id,token),encryptToken(c.env,actor.project_id,webhook)])
 await requireStepUp(c,c.get('actor'),'integration.install')
 const now=Date.now()
 await batch([
  c.env.DB.prepare(`INSERT INTO helpscout_connections(project_id,mailbox_id,token_cipher,webhook_cipher,status,cursor,updated_at,sync_actor_id,sync_session_hash,continuous,next_sync_at) VALUES(?,?,?,?,'connected',?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET token_cipher=excluded.token_cipher,webhook_cipher=excluded.webhook_cipher,generation=helpscout_connections.generation+1,status='connected',pending=1,sync_lock=NULL,sync_lock_until=NULL,error_code=NULL,updated_at=excluded.updated_at,sync_actor_id=excluded.sync_actor_id,sync_session_hash=excluded.sync_session_hash,continuous=excluded.continuous,next_sync_at=excluded.next_sync_at WHERE helpscout_connections.mailbox_id=excluded.mailbox_id`).bind(actor.project_id,mailbox,tokenCipher,webhookCipher,new Date(start).toISOString(),now,actor.actor_id,actor.session_hash,body.continuous?1:0,now),
  c.env.DB.prepare('INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM helpscout_connections WHERE project_id=? AND mailbox_id=? AND token_cipher=? AND webhook_cipher=?) THEN 1 ELSE 0 END').bind(actor.project_id,mailbox,tokenCipher,webhookCipher),
  auditStatement(c.env.DB,{projectId:actor.project_id,category:'integration',action:'helpscout.connected',actor:{type:'user',id:actor.actor_id},source:requestSource(c),detail:{mailboxId:mailbox,mode:'reviewed-import'}},now),
 ])
 return c.json({data:view(await get(c.env.DB,actor.project_id))},prior?200:201)
})
helpScoutSettings.delete(root,async c=>{
 const {actor,batch}=await helpScoutActor(c,'integrations.install');await requireStepUp(c,c.get('actor'),'integration.remove')
 await batch([
  c.env.DB.prepare("UPDATE helpscout_connections SET status='disconnected',token_cipher=NULL,webhook_cipher=NULL,generation=generation+1,sync_lock=NULL,sync_lock_until=NULL,pending=0,continuous=0,sync_actor_id=NULL,sync_session_hash=NULL,updated_at=? WHERE project_id=?").bind(Date.now(),actor.project_id),
  auditStatement(c.env.DB,{projectId:actor.project_id,category:'integration',action:'helpscout.disconnected',actor:{type:'user',id:actor.actor_id},source:requestSource(c)}),
 ])
 return c.json({disconnected:true})
})

helpScoutSettings.post(root+'/sync',async c=>{
 const grant=await helpScoutActor(c,'data.import'),row=await get(c.env.DB,grant.actor.project_id)
 if(!row||row.status!=='connected')throw new HTTPException(409,{message:'Connect Help Scout first'})
 const result=await syncHelpScout(c.env,row,grant,requestSource(c))
 return c.json({data:view(await get(c.env.DB,grant.actor.project_id)),...result},202)
})

helpScoutEvents.post('/:projectId/events',async c=>{
 const project=c.req.param('projectId'),row=await get(c.env.DB,project)
 if(!row||row.status!=='connected'||!row.webhook_cipher)throw new HTTPException(404)
 const body=await helpScoutBytes(c.req.raw,1024*1024),signature=c.req.header('X-HelpScout-Signature')??'',event=c.req.header('X-HelpScout-Event')??''
 if(!/^convo\.(created|customer\.reply\.created|agent\.reply\.created|note\.created|status|assigned|moved)$/.test(event)||!/^[A-Za-z0-9+/]{27}=$/.test(signature))throw new HTTPException(403)
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(await decryptToken(c.env,project,row.webhook_cipher)),{name:'HMAC',hash:'SHA-1'},false,['verify'])
 if(!await crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(signature),x=>x.charCodeAt(0)),body))throw new HTTPException(403)
 let value:any;try{value=JSON.parse(new TextDecoder().decode(body))}catch{throw new HTTPException(400)}
 if(!value||String(value.mailboxId)!==row.mailbox_id||!helpScoutId(value.id))throw new HTTPException(403)
 const digest=await hashToken(event+':'+new TextDecoder().decode(body)),now=Date.now()
 const result=await c.env.DB.batch([
  c.env.DB.prepare("INSERT OR IGNORE INTO helpscout_webhook_receipts(project_id,digest,received_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM helpscout_connections WHERE project_id=? AND generation=? AND status='connected')").bind(project,digest,now,project,row.generation),
  // Replays only mark pending if this invocation inserted a fresh receipt.
  c.env.DB.prepare("UPDATE helpscout_connections SET pending=1 WHERE project_id=? AND generation=? AND status='connected' AND changes()>0").bind(project,row.generation),
 ])
 return c.json({accepted:true,duplicate:!result[0].meta.changes},202)
})
