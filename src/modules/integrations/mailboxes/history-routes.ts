import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {scope} from '../../management/common'
import {importActor,admitExport} from '../../move-in/routes'
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
  const result=await admitExport(c.env,actor,'mailbox',`mailbox-${row.provider}-history.jsonl`,bytes)
  if(result.status>=200&&result.status<300)await c.env.DB.prepare("UPDATE mailbox_connections SET cursor_json=json_set(cursor_json,'$.importId',?,'$.folders',json(?)),last_sync_at=? WHERE id=? AND sync_lock=? AND json_extract(cursor_json,'$.mode')='history'").bind(result.body.data.id,JSON.stringify(folders),Date.now(),row.id,lease).run()
  return c.json({...result.body,messages:messages.length},result.status as 200)
 }catch(error){if(error instanceof HTTPException)throw error;throw new HTTPException(502,{message:'History read failed; no live mail was started. Check the connection and try again.'})}
 finally{await c.env.DB.prepare('UPDATE mailbox_connections SET sync_lock=NULL,sync_lock_until=NULL WHERE id=? AND sync_lock=?').bind(row.id,lease).run()}
})
