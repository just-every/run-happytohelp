import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {decryptToken} from '../integrations/secrets'
import {auditStatement,type AuditSource} from '../audit/record'
import {stageImport} from '../move-in/routes'
import {canonicalJson} from '../import-kit/src/provenance/identity'
import {helpScoutGrant} from './helpscout-authority'
import {helpScoutReader,helpScoutSnapshot} from './helpscout-provider'
import type {Connection} from './helpscout-store'

export async function syncHelpScout(env:Env,row:Connection,grant:Awaited<ReturnType<typeof helpScoutGrant>>,source:AuditSource='system'){
 const {actor,batch}=grant
 if(!row||row.status!=='connected'||!row.token_cipher)throw new HTTPException(409,{message:'Connect Help Scout first'})
 const lock=crypto.randomUUID(),now=Date.now(),cutoff=new Date(now).toISOString()
 const claimed=await batch([env.DB.prepare("UPDATE helpscout_connections SET sync_lock=?,sync_lock_until=?,pending=0 WHERE project_id=? AND generation=? AND status='connected' AND (sync_lock IS NULL OR sync_lock_until<?)").bind(lock,now+120000,actor.project_id,row.generation,now)])
 if(!claimed[1].meta.changes)throw new HTTPException(409,{message:'Help Scout sync is already active or the connection changed'})
 const current=()=>env.DB.prepare("INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM helpscout_connections WHERE project_id=? AND generation=? AND status='connected' AND sync_lock=? AND sync_lock_until>?) THEN 1 ELSE 0 END").bind(actor.project_id,row.generation,lock,Date.now())
 const runs:string[]=[];let unchanged=0
 try{
  const snapshots=await helpScoutSnapshot(helpScoutReader(await decryptToken(env,actor.project_id,row.token_cipher)),row.mailbox_id,row.cursor)
  for(const snapshot of snapshots){
   const sourceDigest=await hashToken('helpscout:'+row.mailbox_id+':'+snapshot.id),content=canonicalJson({responses:snapshot.responses}),digest=await hashToken(content)
   const receipt=await env.DB.prepare('SELECT r.run_id,m.state FROM helpscout_sync_receipts r JOIN move_in_runs m ON m.id=r.run_id WHERE r.project_id=? AND r.mailbox_id=? AND r.source_digest=? AND r.content_digest=?').bind(actor.project_id,row.mailbox_id,sourceDigest,digest).first<{run_id:string;state:string}>()
   if(receipt){if(receipt.state==='erased')throw new HTTPException(410,{message:'helpscout_erased_identity'});unchanged++;continue}
   await batch([current()])
   // Stage through the same native upload door as Move in. This preserves its
   // identity/erasure fences, source custody, deduplication and explicit review;
   // provider credentials never become native API credentials or tool authority.
   const database=new Proxy(env.DB,{get(target,key){
    if(key==='batch')return async(statements:D1PreparedStatement[])=>{
     const results=await batch([current(),...statements,current()])
     return results.slice(2,-3)
    }
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value
   }})
   const response=await stageImport({...env,DB:database},actor,'helpscout','helpscout-'+digest+'.json',new TextEncoder().encode(content))
   const result=await response.json() as any
   if(!response.ok)throw new HTTPException(response.status===410?410:409,{message:response.status===410?'helpscout_erased_identity':'helpscout_staging_refused'})
   const run=result.data?.id;if(typeof run!=='string')throw new HTTPException(502,{message:'helpscout_staging_failed'})
   await batch([current(),env.DB.prepare('INSERT OR IGNORE INTO helpscout_sync_receipts(project_id,mailbox_id,source_digest,content_digest,run_id,created_at) VALUES(?,?,?,?,?,?)').bind(actor.project_id,row.mailbox_id,sourceDigest,digest,run,Date.now())])
   runs.push(run)
  }
  await batch([current(),env.DB.prepare('UPDATE helpscout_connections SET cursor=?,last_sync_at=?,error_code=NULL,sync_lock=NULL,sync_lock_until=NULL,updated_at=?,next_sync_at=? WHERE project_id=? AND sync_lock=?').bind(cutoff,Date.now(),Date.now(),Date.now()+300000,actor.project_id,lock),auditStatement(env.DB,{projectId:actor.project_id,category:'integration',action:'helpscout.synced',actor:{type:'user',id:actor.actor_id},source,detail:{staged:runs.length,unchanged}})])
  return {runs,unchanged}
 }catch(error){
  const code=error instanceof HTTPException&&/^helpscout_[a-z_]+$/.test(error.message)?error.message:'helpscout_sync_interrupted'
  await env.DB.prepare('UPDATE helpscout_connections SET error_code=?,pending=1,sync_lock=NULL,sync_lock_until=NULL,updated_at=? WHERE project_id=? AND generation=? AND sync_lock=?').bind(code,Date.now(),actor.project_id,row.generation,lock).run()
  if(error instanceof HTTPException)throw error
  throw new HTTPException(502,{message:code})
 }
}
