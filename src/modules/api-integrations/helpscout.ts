import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {encryptToken,decryptToken} from '../integrations/secrets'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement,requestSource} from '../audit/record'
import {moveInRoutes} from '../move-in/routes'
import {canonicalJson} from '../import-kit/src/provenance/identity'
import {helpScoutActor,helpScoutBytes} from './helpscout-authority'
import {helpScoutId,helpScoutReader,helpScoutSnapshot} from './helpscout-provider'

interface Connection {project_id:string;mailbox_id:string;token_cipher:string|null;webhook_cipher:string|null;generation:number;status:'connected'|'disconnected';cursor:string;pending:number;sync_lock:string|null;sync_lock_until:number|null;last_sync_at:number|null;error_code:string|null;updated_at:number}
const view=(row:Connection|null)=>row?{mailboxId:row.mailbox_id,status:row.status,cursor:row.cursor,pending:Boolean(row.pending),lastSyncAt:row.last_sync_at,error:row.error_code,scopes:['inbox:read'],mode:'reviewed-import',syncing:!!row.sync_lock&&Number(row.sync_lock_until)>Date.now()}:null
const get=(db:D1Database,project:string)=>db.prepare('SELECT * FROM helpscout_connections WHERE project_id=?').bind(project).first<Connection>()
const secret=(value:unknown)=>{if(typeof value!=='string'||value.length<16||value.length>4096||/[\r\n\x00]/.test(value))throw new HTTPException(400,{message:'A private provider credential is required'});return value}
export const helpScoutSettings=new Hono<AppEnv>(),helpScoutEvents=new Hono<AppEnv>()
const root='/projects/:projectId/connections/helpscout'

helpScoutSettings.get(root,async c=>{
 const {actor}=await helpScoutActor(c,'data.import'),row=await get(c.env.DB,actor.project_id)
 const receipts=await c.env.DB.prepare('SELECT r.run_id,r.created_at,m.state FROM helpscout_sync_receipts r JOIN move_in_runs m ON m.id=r.run_id WHERE r.project_id=? ORDER BY r.created_at DESC,r.run_id LIMIT 100').bind(actor.project_id).all()
 return c.json({data:view(row),attempts:receipts.results})
})
helpScoutSettings.post(root,async c=>{
 const {actor,batch}=await helpScoutActor(c,'integrations.install');await requireStepUp(c,c.get('actor'),'integration.install')
 let body:any;try{body=JSON.parse(new TextDecoder().decode(await helpScoutBytes(c.req.raw,16384)))}catch(error){if(error instanceof HTTPException)throw error;throw new HTTPException(400,{message:'JSON connection settings required'})}
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
  c.env.DB.prepare(`INSERT INTO helpscout_connections(project_id,mailbox_id,token_cipher,webhook_cipher,status,cursor,updated_at) VALUES(?,?,?,?,'connected',?,?) ON CONFLICT(project_id) DO UPDATE SET token_cipher=excluded.token_cipher,webhook_cipher=excluded.webhook_cipher,generation=helpscout_connections.generation+1,status='connected',pending=1,sync_lock=NULL,sync_lock_until=NULL,error_code=NULL,updated_at=excluded.updated_at WHERE helpscout_connections.mailbox_id=excluded.mailbox_id`).bind(actor.project_id,mailbox,tokenCipher,webhookCipher,new Date(start).toISOString(),now),
  c.env.DB.prepare('INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM helpscout_connections WHERE project_id=? AND mailbox_id=? AND token_cipher=? AND webhook_cipher=?) THEN 1 ELSE 0 END').bind(actor.project_id,mailbox,tokenCipher,webhookCipher),
  auditStatement(c.env.DB,{projectId:actor.project_id,category:'integration',action:'helpscout.connected',actor:{type:'user',id:actor.actor_id},source:requestSource(c),detail:{mailboxId:mailbox,mode:'reviewed-import'}},now),
 ])
 return c.json({data:view(await get(c.env.DB,actor.project_id))},prior?200:201)
})
helpScoutSettings.delete(root,async c=>{
 const {actor,batch}=await helpScoutActor(c,'integrations.install');await requireStepUp(c,c.get('actor'),'integration.remove')
 await batch([
  c.env.DB.prepare("UPDATE helpscout_connections SET status='disconnected',token_cipher=NULL,webhook_cipher=NULL,generation=generation+1,sync_lock=NULL,sync_lock_until=NULL,pending=0,updated_at=? WHERE project_id=?").bind(Date.now(),actor.project_id),
  auditStatement(c.env.DB,{projectId:actor.project_id,category:'integration',action:'helpscout.disconnected',actor:{type:'user',id:actor.actor_id},source:requestSource(c)}),
 ])
 return c.json({disconnected:true})
})

helpScoutSettings.post(root+'/sync',async c=>{
 const {actor,batch}=await helpScoutActor(c,'data.import'),row=await get(c.env.DB,actor.project_id)
 if(!row||row.status!=='connected'||!row.token_cipher)throw new HTTPException(409,{message:'Connect Help Scout first'})
 const lock=crypto.randomUUID(),now=Date.now(),cutoff=new Date(now).toISOString()
 const claimed=await batch([c.env.DB.prepare("UPDATE helpscout_connections SET sync_lock=?,sync_lock_until=?,pending=0 WHERE project_id=? AND generation=? AND status='connected' AND (sync_lock IS NULL OR sync_lock_until<?)").bind(lock,now+120000,actor.project_id,row.generation,now)])
 if(!claimed[1].meta.changes)throw new HTTPException(409,{message:'Help Scout sync is already active or the connection changed'})
 const current=()=>c.env.DB.prepare("INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM helpscout_connections WHERE project_id=? AND generation=? AND status='connected' AND sync_lock=? AND sync_lock_until>?) THEN 1 ELSE 0 END").bind(actor.project_id,row.generation,lock,Date.now())
 const runs:string[]=[];let unchanged=0
 try{
  const snapshots=await helpScoutSnapshot(helpScoutReader(await decryptToken(c.env,actor.project_id,row.token_cipher)),row.mailbox_id,row.cursor)
  for(const snapshot of snapshots){
   const sourceDigest=await hashToken('helpscout:'+row.mailbox_id+':'+snapshot.id),content=canonicalJson({responses:snapshot.responses}),digest=await hashToken(content)
   const receipt=await c.env.DB.prepare('SELECT r.run_id,m.state FROM helpscout_sync_receipts r JOIN move_in_runs m ON m.id=r.run_id WHERE r.project_id=? AND r.mailbox_id=? AND r.source_digest=? AND r.content_digest=?').bind(actor.project_id,row.mailbox_id,sourceDigest,digest).first<{run_id:string;state:string}>()
   if(receipt){if(receipt.state==='erased')throw new HTTPException(410,{message:'helpscout_erased_identity'});unchanged++;continue}
   await batch([current()])
   // Stage through the same native upload door as Move in. This preserves its
   // identity/erasure fences, source custody, deduplication and explicit review;
   // provider credentials never become native API credentials or tool authority.
   const headers=new Headers({'Content-Type':'application/json','X-Import-Filename':'helpscout-'+digest+'.json'})
   for(const name of ['Authorization','Cookie','Origin']){const value=c.req.header(name);if(value)headers.set(name,value)}
   const database=new Proxy(c.env.DB,{get(target,key){
    if(key==='batch')return async(statements:D1PreparedStatement[])=>{
     const results=await batch([current(),...statements,current()])
     return results.slice(2,-3)
    }
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value
   }})
   const response=await moveInRoutes.fetch(new Request(new URL('/projects/'+encodeURIComponent(actor.project_id)+'/imports?vendor=helpscout',c.req.url),{method:'POST',headers,body:content}),{...c.env,DB:database},c.executionCtx)
   const result=await response.json() as any
   if(!response.ok)throw new HTTPException(response.status===410?410:409,{message:response.status===410?'helpscout_erased_identity':'helpscout_staging_refused'})
   const run=result.data?.id;if(typeof run!=='string')throw new HTTPException(502,{message:'helpscout_staging_failed'})
   await batch([current(),c.env.DB.prepare('INSERT OR IGNORE INTO helpscout_sync_receipts(project_id,mailbox_id,source_digest,content_digest,run_id,created_at) VALUES(?,?,?,?,?,?)').bind(actor.project_id,row.mailbox_id,sourceDigest,digest,run,Date.now())])
   runs.push(run)
  }
  await batch([current(),c.env.DB.prepare('UPDATE helpscout_connections SET cursor=?,last_sync_at=?,error_code=NULL,sync_lock=NULL,sync_lock_until=NULL,updated_at=? WHERE project_id=? AND sync_lock=?').bind(cutoff,Date.now(),Date.now(),actor.project_id,lock),auditStatement(c.env.DB,{projectId:actor.project_id,category:'integration',action:'helpscout.synced',actor:{type:'user',id:actor.actor_id},source:requestSource(c),detail:{staged:runs.length,unchanged}})])
  return c.json({data:view(await get(c.env.DB,actor.project_id)),runs,unchanged},202)
 }catch(error){
  const code=error instanceof HTTPException&&/^helpscout_[a-z_]+$/.test(error.message)?error.message:'helpscout_sync_interrupted'
  await c.env.DB.prepare('UPDATE helpscout_connections SET error_code=?,pending=1,sync_lock=NULL,sync_lock_until=NULL,updated_at=? WHERE project_id=? AND generation=? AND sync_lock=?').bind(code,Date.now(),actor.project_id,row.generation,lock).run()
  if(error instanceof HTTPException)throw error
  throw new HTTPException(502,{message:code})
 }
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
