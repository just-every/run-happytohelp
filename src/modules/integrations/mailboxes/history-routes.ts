import {sha256} from '../../import-kit/src/provenance/identity'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {scope} from '../../management/common'
import {importActor,admitExport,type ImportActor} from '../../move-in/routes'
import {getMailbox} from './store'
import {mailboxMode} from './mode'
import {historyFolders,readHistory} from './history-provider'
import {historySource} from './history-source'

export const mailboxHistoryRoutes=new Hono<AppEnv>()
const root='/projects/:projectId/mailboxes/:mailboxId/history'
async function historyMailbox(c:any){const actor=await scope(c,true),row=await getMailbox(c.env,actor.projectId,c.req.param('mailboxId'));if(mailboxMode(row)!=='history'||row.status!=='connected')throw new HTTPException(409,{message:'Connect with Import history only before reading history'});return row}
mailboxHistoryRoutes.get(`${root}/folders`,async c=>{const row=await historyMailbox(c);try{return c.json({data:await historyFolders(c.env,row)})}catch(error){if(error instanceof HTTPException)throw error;throw new HTTPException(502,{message:'Could not read mailbox folders. Check the connection; no mail was changed.'})}})
mailboxHistoryRoutes.post(root,async c=>{
 const actor=await importActor(c),row=await historyMailbox(c),body=await c.req.json()
 if(!Array.isArray(body.folders)||!body.folders.length||body.folders.length>20||body.folders.some((v:unknown)=>typeof v!=='string'||!v||v.length>2048||/[\r\n\0]/.test(v)))throw new HTTPException(400,{message:'Select between one and twenty mailbox folders'})
 const lease=crypto.randomUUID(),claim=await c.env.DB.prepare("UPDATE mailbox_connections SET sync_lock=?,sync_lock_until=? WHERE id=? AND project_id=? AND status='connected' AND (sync_lock_until IS NULL OR sync_lock_until<?) AND json_extract(cursor_json,'$.mode')='history'").bind(lease,Date.now()+900000,row.id,row.project_id,Date.now()).run()
 if(!claim.meta.changes)throw new HTTPException(409,{message:'Mailbox history is already being read or the connection changed'})
 try{
  const available=new Set((await historyFolders(c.env,row)).map(folder=>folder.id)),folders=[...new Set<string>(body.folders)].sort()
  if(folders.some(folder=>!available.has(folder)))throw new HTTPException(400,{message:'A selected folder is no longer available. Reload folders.'})
  const messages=await readHistory(c.env,row,folders)
  if(!messages.length)return c.json({empty:true,messages:0})
  const bytes=await historySource(row,messages)
  // Re-read both session authority and connection after the provider work.
  await importActor(c)
  const live=await getMailbox(c.env,row.project_id,row.id)
  if(live.status!=='connected'||mailboxMode(live)!=='history'||live.credential_version!==row.credential_version)throw new HTTPException(409,{message:'Mailbox connection changed; nothing was imported'})
  const result=await admitHistory(c.env,actor,`mailbox-${row.provider}-history.jsonl`,bytes)
  if(result.status>=200&&result.status<300)await c.env.DB.prepare("UPDATE mailbox_connections SET cursor_json=json_set(cursor_json,'$.importId',?,'$.folders',json(?)),last_sync_at=? WHERE id=? AND sync_lock=? AND json_extract(cursor_json,'$.mode')='history'").bind(result.body.data.id,JSON.stringify(folders),Date.now(),row.id,lease).run()
  return c.json({...result.body,messages:messages.length},result.status as 200)
 }catch(error){if(error instanceof HTTPException)throw error;throw new HTTPException(502,{message:'History read failed; no live mail was started. Check the connection and try again.'})}
 finally{await c.env.DB.prepare('UPDATE mailbox_connections SET sync_lock=NULL,sync_lock_until=NULL WHERE id=? AND sync_lock=?').bind(row.id,lease).run()}
})

/** An undone import retains immutable custody and journals. Repackage only its
 * record separators to give a later review a new artifact; source identities and
 * payload hashes remain identical. Ordinary repeated reads reuse the same run. */
async function admitHistory(env:AppEnv['Bindings'],actor:ImportActor,filename:string,original:Uint8Array){
 let bytes=original
 for(let attempt=0;attempt<1000;attempt++){
  const prior=await env.DB.prepare("SELECT state,actor_id FROM move_in_runs WHERE project_id=? AND vendor='mailbox' AND artifact_hash=?").bind(actor.project_id,sha256(bytes)).first<{state:string;actor_id:string}>()
  if(!prior||prior.state!=='undone'||prior.actor_id!==actor.actor_id)return admitExport(env,actor,'mailbox',filename,bytes)
  if(bytes.length>=2*1024*1024)throw new HTTPException(413,{message:'History needs a smaller selection to import again after undo'})
  const next=new Uint8Array(bytes.length+1);next.set(bytes);next[bytes.length]=10;bytes=next
 }
 throw new HTTPException(409,{message:'This history has too many prior undone imports; select a different folder set'})
}
