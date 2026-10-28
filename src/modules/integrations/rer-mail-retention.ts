import type {Env} from '../../platform/env'
import {cronRoom} from '../../platform/cron-budget'
/** Acknowledged MIME is a private transport buffer, not conversation history.
 * Keep receipt/digest tombstones after deleting content; failed intake has seven
 * days for the platform's bounded retry. No body enters the scheduler's logs. */
export async function expireRerMailRaw(env:Env){
 if(!cronRoom(env,5))return
 const rows=(await env.DB.prepare(`SELECT r.delivery_id,r.body_sha256,r.object_key FROM rer_mail_raw_objects r JOIN rer_mail_ingress i ON i.delivery_id=r.delivery_id WHERE (i.state='complete' AND i.updated_at<?) OR i.updated_at<? ORDER BY i.updated_at LIMIT 10`).bind(Date.now()-60000,Date.now()-7*86400000).all<{delivery_id:string;body_sha256:string;object_key:string}>()).results
 for(const row of rows){
  if(!cronRoom(env,2))break
  await env.FILES.delete(row.object_key)
  await env.DB.batch([
   env.DB.prepare('DELETE FROM rer_mail_raw_objects WHERE delivery_id=? AND body_sha256=?').bind(row.delivery_id,row.body_sha256),
   env.DB.prepare("UPDATE rer_mail_ingress SET raw_key='' WHERE delivery_id=? AND raw_key=?").bind(row.delivery_id,row.object_key),
  ])
 }
 // A process can die after its R2 put but before the reference transaction.
 // Remove only old unreferenced objects; never guess from a filename alone.
 if(!cronRoom(env,1))return
 const page=await env.FILES.list({prefix:'rer-mail/',limit:50}),old=page.objects.filter(object=>object.uploaded.getTime()<Date.now()-7*86400000)
 if(!old.length)return
 const retained=(await env.DB.prepare('SELECT object_key FROM rer_mail_raw_objects WHERE object_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(old.map(object=>object.key))).all<{object_key:string}>()).results
 const known=new Set(retained.map(row=>row.object_key)),orphaned=old.filter(object=>!known.has(object.key)).map(object=>object.key)
 if(orphaned.length)await env.FILES.delete(orphaned)
}
