import type {Env} from '../../platform/env'
import {messagesData,iso,person} from './dashboard-data'
import {trackedTranscripts} from './tracked-transcript'
import {attachInboundOrigins} from '../integrations/inbound-origin'
import {ceilingTranscripts} from './ceiling-transcript'
import {noteMediaData} from '../collaboration/note-media'

/** Hydrate a selected page together rather than repeating the same relations
 * for every bucket and every message. Missing non-root buckets remain null. */
export async function bucketsData(env:Env,conversation:any,bucketIds:string[]){
 if(!bucketIds.length)return []
 const ids=JSON.stringify(bucketIds),root=bucketIds.includes(String(conversation.id))
 const [data,tracked,ceilings]=await Promise.all([
  env.DB.batch<any>([
   env.DB.prepare('SELECT * FROM conversation_buckets WHERE conversation_id=? AND id IN (SELECT value FROM json_each(?))').bind(conversation.id,ids),
   env.DB.prepare('SELECT * FROM messages WHERE project_id=? AND conversation_id=? AND coalesce(bucket_id,conversation_id) IN (SELECT value FROM json_each(?)) ORDER BY revision').bind(conversation.project_id,conversation.id,ids),
   ...(root?[
    env.DB.prepare(`SELECT n.*,coalesce((SELECT agent_name||' for '||sponsor_name FROM h2h_agent_operations op WHERE op.project_id=?2 AND json_extract(op.result_json,'$.note_id')=n.id),u.name) name FROM conversation_notes n JOIN users u ON u.id=n.user_id WHERE n.conversation_id=?1 UNION ALL SELECT id,conversation_id,user_id,content,created_at,name FROM api_notes WHERE conversation_id=?1 ORDER BY created_at`).bind(conversation.id,conversation.project_id),
    env.DB.prepare('SELECT * FROM move_in_notes WHERE conversation_id=? AND project_id=? ORDER BY created_at,id').bind(conversation.id,conversation.project_id)
   ]:[])
  ]),trackedTranscripts(env,conversation,bucketIds),ceilingTranscripts(env,conversation,bucketIds)
 ])
 const buckets=new Map(data[0].results.map(row=>[String(row.id),row])),byBucket=new Map<string,any[]>(),hydrated=new Map<string,any[]>()
 for(const row of data[1].results){const key=String(row.bucket_id||row.conversation_id);if(!byBucket.has(key))byBucket.set(key,[]);byBucket.get(key)!.push(row)}
 const noteMedia = await noteMediaData(env,conversation.project_id,[...(data[2]?.results || []),...(data[3]?.results || [])].map((row:any)=>String(row.id)));
 const allMessages=await attachInboundOrigins(env,String(conversation.project_id),await messagesData(env,data[1].results))
 for(const message of allMessages){const key=String(message.bucket_id);if(!hydrated.has(key))hydrated.set(key,[]);hydrated.get(key)!.push(message)}
 return bucketIds.map(bucketId=>{
  const bucket=buckets.get(bucketId)
  if(!bucket&&bucketId!==conversation.id)return null
  const rows=byBucket.get(bucketId)||[],messages=hydrated.get(bucketId)||[],notes=bucketId===conversation.id?data[2]?.results||[]:[],importedNotes=bucketId===conversation.id?data[3]?.results||[]:[]
  const events=[...importedNotes.map((n:any)=>({id:n.id,type:'INTERNAL_NOTE',payload:n.content,content:n.content,media:noteMedia.get(n.id)||[],conversation_id:conversation.id,bucket_id:bucketId,agent:person({id:`import:${JSON.parse(n.author_json).id}`,name:JSON.parse(n.author_json).name||'Imported author'}),agent_id:`import:${JSON.parse(n.author_json).id}`,created_at:iso(n.created_at),imported:true})),...notes.map((n:any)=>({id:n.id,type:'INTERNAL_NOTE',payload:n.content,content:n.content,media:noteMedia.get(n.id)||[],conversation_id:conversation.id,bucket_id:bucketId,agent:person({id:n.user_id,name:n.name}),agent_id:n.user_id,created_at:iso(n.created_at)})),...tracked.get(bucketId)||[],...ceilings.get(bucketId)||[]].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id)))
  const counts:Record<string,number>={contact_messages:rows.filter(r=>r.actor_role==='contact').length,agent_messages:rows.filter(r=>r.actor_role!=='contact').length,agent_events_internal_note:notes.length+importedNotes.length}
  for(const event of events){if(event.type==='INTERNAL_NOTE'||event.type==='AI_REPLY_SKIPPED')continue;const key=`${event.agent_id?'agent':'contact'}_events_${String(event.type).toLowerCase()}`;counts[key]=(counts[key]||0)+1}
  const starts=[...rows.map(row=>Number(row.created_at)),...events.map(event=>Date.parse(event.created_at||''))].filter(Number.isFinite)
  const createdAt=bucket?.created_at||(starts.length?Math.min(...starts):conversation.created_at)
  const updatedAt=Math.max(Number(rows.at(-1)?.created_at||0),...events.map(event=>Date.parse(event.created_at||'')||0),Number(bucket?.created_at||conversation.created_at))
  return {id:bucketId,conversation_id:conversation.id,type:'messages',created_at:iso(createdAt),updated_at:iso(updatedAt),first_message:messages[0]||null,last_message:messages.at(-1)||null,counts,messages,events}
 })
}
export async function bucketData(env:Env,conversation:any,bucketId:string){return (await bucketsData(env,conversation,[bucketId]))[0]}
