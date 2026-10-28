import type {Env} from '../../platform/env'
/** The inbox caller supplies its already-authorized conversation channels. Ordinary
 * transcripts remain independent of channel storage; no schema probing or fallback. */
export async function channelStatuses(env:Env,rows:any[],channels:ReadonlyMap<string,string|undefined>=new Map()){
 const ids=JSON.stringify(rows.filter(row=>!['contact','system'].includes(row.actor_role)&&!row.erased_at&&['sms','whatsapp','instagram','messenger','slack'].includes(channels.get(String(row.conversation_id))||'')).map(row=>row.id))
 if(ids==='[]')return new Map<string,any>()
 const result=await env.DB.prepare(`SELECT m.id,c.channel,coalesce(s.state,'not_recorded') state,s.error_code FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id LEFT JOIN support_channel_sends s ON s.message_id=m.id AND s.project_id=m.project_id WHERE m.id IN (SELECT value FROM json_each(?)) AND c.channel IN ('sms','whatsapp','instagram','messenger','slack') AND m.erased_at IS NULL`).bind(ids).all<any>()
 return new Map<string,any>(result.results.map(row=>[String(row.id),{channel:row.channel,state:row.state,reason:row.error_code}]))
}
