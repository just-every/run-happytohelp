import type {Env} from '../../platform/env'
import {liveConnection,type Connection} from './model'
import type {Inbound} from './protocol'
/** Only authenticated provider intake calls this; neither settings nor archive replay grants consent. */
export async function recordConsent(env:Env,row:Connection,event:Inbound,identity:string,contactId:string,at:number){
 const kind=event.optOut?'stop':event.optIn?'start':event.templateConsent?'continuation':null
 if(!kind)return
 const guard=`EXISTS(SELECT 1 FROM support_channel_connections WHERE id=? AND ${liveConnection}) AND NOT EXISTS(SELECT 1 FROM support_channel_fences WHERE connection_id=? AND identity_hash=?)`
 await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO support_channel_consent SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`).bind(row.id,event.id,identity,contactId,event.channel,kind,at,Date.now(),row.id,row.id,identity),
  ...(kind!=='continuation'?[env.DB.prepare(`UPDATE support_channel_threads SET opted_out=?,reply_consent_at=(SELECT received_at FROM support_channel_consent WHERE connection_id=? AND event_id=?),template_opted_out=MAX(template_opted_out,?),template_consent=CASE WHEN ? THEN 0 ELSE template_consent END WHERE connection_id=? AND identity_hash=? AND channel_id=? AND EXISTS(SELECT 1 FROM support_channel_consent f WHERE f.connection_id=? AND f.event_id=? AND (f.received_at>reply_consent_at OR (f.received_at=reply_consent_at AND f.kind='stop')) AND (f.kind='stop' OR f.at>=coalesce((SELECT max(stopped.at) FROM support_channel_consent stopped WHERE stopped.connection_id=f.connection_id AND stopped.identity_hash=f.identity_hash AND stopped.channel_id=f.channel_id AND stopped.kind='stop'),0))) AND ${guard}`).bind(kind==='stop'?1:0,row.id,event.id,kind==='stop'?1:0,kind==='stop'?1:0,row.id,identity,event.channel,row.id,event.id,row.id,row.id,identity)]:[]),
  ...(kind==='continuation'?[env.DB.prepare(`UPDATE support_channel_threads SET template_consent=1 WHERE connection_id=? AND identity_hash=? AND channel_id=? AND opted_out=0 AND template_opted_out=0 AND ${guard}`).bind(row.id,identity,event.channel,row.id,row.id,identity)]:[]),
 ])
}
