import type {Env} from '../../platform/env'
import {iso,person} from './dashboard-data'

/** Only explicitly attributed events belong to a conversation transcript.
 * Look up valid actors and insights once for the selected buckets. */
export async function trackedTranscripts(env:Env,conversation:any,bucketIds:string[]){
 if(!bucketIds.length)return new Map<string,any[]>()
 const data=await env.DB.batch<any>([
  env.DB.prepare(`SELECT e.* FROM context_tracked_events e
   JOIN conversations c ON c.id=? AND c.project_id=e.project_id AND c.contact_id=e.subject_id
   WHERE e.project_id=? AND e.subject_id=? AND json_valid(e.payload)
   AND json_extract(e.payload,'$.conversation_id')=c.id
   AND coalesce(json_extract(e.payload,'$.bucket_id'),c.id) IN (SELECT value FROM json_each(?))
   ORDER BY e.created_at,e.id`).bind(conversation.id,conversation.project_id,conversation.contact_id,JSON.stringify(bucketIds)),
  env.DB.prepare('SELECT id,name,email FROM contacts WHERE id=? AND project_id=?').bind(conversation.contact_id,conversation.project_id),
  env.DB.prepare(`SELECT u.id,u.name FROM users u WHERE EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.project_id=?1) OR (u.email='erased:'||u.id AND EXISTS(SELECT 1 FROM context_tracked_events e WHERE e.project_id=?1 AND json_valid(e.payload) AND json_extract(e.payload,'$.agent_id')=u.id))`).bind(conversation.project_id),
  env.DB.prepare('SELECT id FROM context_insights WHERE project_id=? AND subject_id=?').bind(conversation.project_id,conversation.contact_id)
 ])
 const contact=person(data[1].results[0]),agents=new Map(data[2].results.map(row=>[row.id,row])),insights=new Set(data[3].results.map(row=>row.id)),events=new Map<string,any[]>()
 for(const row of data[0].results){
  const data=JSON.parse(String(row.payload)),bucketId=data.bucket_id??conversation.id
  let payload:any
  if(row.type==='PAGE_VIEW'){
   if(typeof data.url!=='string'||!data.url.trim())continue
   if(!/^https?:\/\//i.test(data.url)&&!/^\/(?!\/)/.test(data.url))continue
   payload=data.url
  }else if(row.type==='AGENT_ASSIGNED'){
   payload={is_ai:data.is_ai===true,type:typeof data.type==='string'?data.type:undefined,name:typeof data.name==='string'?data.name:undefined,role:typeof data.role==='string'?data.role:undefined}
  }else if(row.type==='USED_INSIGHT'){
   if(typeof data.insight_id!=='string'||!insights.has(data.insight_id))continue
   payload={insight_id:data.insight_id}
  }else continue
  const agent=typeof data.agent_id==='string'?person(agents.get(data.agent_id)):null
  if(data.agent_id&&!agent)continue
  if(!events.has(bucketId))events.set(bucketId,[])
  events.get(bucketId)!.push({id:row.id,type:row.type,payload,conversation_id:conversation.id,bucket_id:bucketId,created_at:iso(row.created_at),agent,agent_id:agent?.id||null,contact:agent?null:contact,contact_id:agent?null:conversation.contact_id,...(row.type==='USED_INSIGHT'?{close:data.close===true}:{})})
 }
 return events
}
export async function trackedTranscript(env:Env,conversation:any,bucketId:string){return (await trackedTranscripts(env,conversation,[bucketId])).get(bucketId)||[]}
