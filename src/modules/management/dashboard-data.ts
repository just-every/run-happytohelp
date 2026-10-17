import {pastResolutionFeedback} from '../outcomes/operator-feedback'
import type {Env} from '../../platform/env'
import {messagesData} from './dashboard-messages'
import {ticketPresentation} from '../tickets/presentation'
import {mergedAlias} from '../conversation-actions/merge-read'
export {messagesData} from './dashboard-messages'
export const iso=(n:any)=>n?new Date(n).toISOString():null
export const person=(p:any)=>{
 if(!p)return null
 const metadata=JSON.parse(p.metadata_json||'{}'),blocked=metadata.is_blocked===false||metadata.is_blocked===0?false:Boolean(metadata.is_blocked||metadata.blocked_at)
 return {...p,...metadata,is_blocked:blocked,blocked_at:blocked?metadata.blocked_at||null:null,is_online:Date.now()-Number(metadata.last_seen_at||0)<90000,display_name:p.name||p.email||(p.is_erased||metadata.is_erased?'Erased contact':'Visitor'),initials:(p.name||p.email||'V').split(/\s+/).map((s:string)=>s[0]).slice(0,2).join('').toUpperCase()}
}
export async function messageData(env:Env,row:any){return (await messagesData(env,[row]))[0]}

/** `joined_via`: how the participant joined (`cc_header`, `operator` or `self`; integrations/participant-proof.ts). */
export function participantData(contact:any,participant:any){const {participant_id,participant_joined_via,conversation_id,...profile}=contact;return {...person(profile),contact_id:contact.id,pivot:{id:participant.id,conversation_id:participant.conversation_id,contact_id:contact.id,joined_via:participant.joined_via}}}

function resolution(row:any){return row?{id:row.id,ordinal:row.ordinal,resolvedAt:new Date(row.resolved_at).toISOString(),outcome:row.outcome,rating:row.value===null?null:{value:row.value,comment:row.comment,updatedAt:new Date(row.rating_updated_at).toISOString(),revision:row.rating_revision}}:null}
function suggestions(row:any){
 if(!row)return null
 const stored=JSON.parse(row.output_json||'{}'),options=JSON.parse(row.options_json||'{}'),loading=['queued','running'].includes(row.state)
 return {...(row.state==='completed'?stored.result||{}:{}),generation_id:row.id,generation_sequence:row.sequence,client_request_id:options.client_request_id||row.id,display_request_version:options.display_request_version??null,loading,loading_message:loading?options.loading_message||'':'',status:loading?'loading':row.state==='completed'?'complete':row.state==='superseded'?'superseded':'error',error:['failed','uncertain','cancelled'].includes(row.state)?row.error||row.state:'',tool_response:row.state==='completed'&&options.tool?stored.result?.response||'':'',generation_deadline_at:new Date(new Date(row.created_at).getTime()+180000).toISOString()}
}

/** The caller supplies authorized conversations (at most one inbox page).
 * Hydrate all relations together so a page does not create N+1 D1 requests. */
export async function conversationsData(env:Env,rows:any[],userId:string,withHistory=false){
 if(!rows.length)return []
 const ids=JSON.stringify(rows.map(row=>row.id)),selected='SELECT value FROM json_each(?)'
 const data=await env.DB.batch<any>([
  env.DB.prepare(`SELECT * FROM contacts WHERE id IN (SELECT contact_id FROM conversations WHERE id IN (${selected}))`).bind(ids),
  env.DB.prepare(`SELECT u.id,u.name,u.email,s.avatar_url FROM users u LEFT JOIN user_settings s ON s.user_id=u.id WHERE u.id IN (SELECT assigned_to FROM conversations WHERE id IN (${selected}))`).bind(ids),
  env.DB.prepare(`SELECT * FROM messages WHERE id IN (SELECT last_message_id FROM conversations WHERE id IN (${selected}))`).bind(ids),
  env.DB.prepare(`SELECT m.conversation_id,count(*) total FROM messages m LEFT JOIN conversation_reads r ON r.conversation_id=m.conversation_id AND r.user_id=? WHERE m.conversation_id IN (${selected}) AND m.actor_role='contact' AND NOT EXISTS(SELECT 1 FROM move_in_message_sources ims WHERE ims.message_id=m.id) AND m.revision>coalesce(r.revision,0) GROUP BY m.conversation_id`).bind(userId,ids),
  env.DB.prepare(`SELECT ca.conversation_id hydration_conversation_id,a.* FROM ai_profiles a JOIN conversation_ai ca ON ca.ai_id=a.id WHERE ca.conversation_id IN (${selected})`).bind(ids),
  env.DB.prepare(`SELECT s.conversation_id hydration_conversation_id,s.vendor,s.source_id,s.subject,s.source_state,s.source_channel FROM move_in_conversations s JOIN conversations c ON c.id=s.conversation_id AND c.project_id=s.project_id WHERE c.id IN (${selected})`).bind(ids),
  env.DB.prepare(`SELECT ct.conversation_id hydration_conversation_id,t.id,t.name FROM workspace_tags t JOIN conversation_tags ct ON ct.tag_id=t.id AND ct.project_id=t.project_id JOIN conversations c ON c.id=ct.conversation_id AND c.project_id=ct.project_id WHERE c.id IN (${selected}) ORDER BY t.normalized_name`).bind(ids),
  env.DB.prepare(`SELECT r.conversation_id hydration_conversation_id,r.id,r.ordinal,r.resolved_at,r.outcome,v.value,v.comment,v.updated_at rating_updated_at,v.revision rating_revision FROM conversations c JOIN conversation_resolutions r ON r.conversation_id=c.id AND r.project_id=c.project_id LEFT JOIN conversation_ratings v ON v.resolution_id=r.id WHERE c.id IN (${selected}) AND c.resolved_at IS NOT NULL AND r.reopened_at IS NULL AND r.id=(SELECT latest.id FROM conversation_resolutions latest WHERE latest.conversation_id=c.id AND latest.project_id=c.project_id AND latest.reopened_at IS NULL ORDER BY latest.ordinal DESC LIMIT 1)`).bind(ids),
  env.DB.prepare(`SELECT g.conversation_id hydration_conversation_id,g.rowid sequence,g.* FROM ai_generations g JOIN conversations c ON c.id=g.conversation_id AND c.project_id=g.project_id WHERE c.id IN (${selected}) AND g.rowid=(SELECT latest.rowid FROM ai_generations latest WHERE latest.project_id=c.project_id AND latest.conversation_id=c.id AND latest.kind='suggestions' ORDER BY latest.rowid DESC LIMIT 1)`).bind(ids),
  env.DB.prepare(`SELECT cp.conversation_id hydration_conversation_id,u.*,cp.id participant_id,cp.joined_via participant_joined_via,cp.conversation_id FROM contacts u JOIN conversation_participants cp ON cp.contact_id=u.id JOIN conversations c ON c.id=cp.conversation_id AND c.project_id=u.project_id WHERE cp.conversation_id IN (${selected}) ORDER BY cp.created_at,cp.id`).bind(ids)
 ])
 const byId=(values:any[])=>new Map(values.map(row=>[String(row.id),row]))
 const relation=(values:any[],many=false)=>{const map=new Map<string,any>();for(const {hydration_conversation_id,...row} of values){const key=String(hydration_conversation_id);if(many){if(!map.has(key))map.set(key,[]);map.get(key).push(row)}else if(!map.has(key))map.set(key,row)}return map}
 const contacts=byId(data[0].results),agents=byId(data[1].results),unread=new Map(data[3].results.map(row=>[String(row.conversation_id),row.total])),ais=relation(data[4].results),imported=relation(data[5].results),tags=relation(data[6].results,true),resolutions=relation(data[7].results),generation=relation(data[8].results),participants=relation(data[9].results,true)
 const [messages,histories,tickets,aliases]=await Promise.all([
  messagesData(env,data[2].results),
  withHistory?Promise.all(rows.map(row=>pastResolutionFeedback(env,row.project_id,row.id,userId))):Promise.resolve([]),
  ticketPresentation(env,rows,userId),
  Promise.all(rows.map(row=>mergedAlias(env,row.project_id,row.id)))
 ])
 const lastMessages=byId(messages)
 return rows.map((row,index)=>{
  const key=String(row.id),contact=person(contacts.get(String(row.contact_id))),agent=row.assigned_to?person(agents.get(String(row.assigned_to))):null,last=lastMessages.get(String(row.last_message_id)),ai=ais.get(key)||null
  return {...row,...tickets.get(key),merged_into:aliases[index]?.target_id??null,imported:imported.get(key)||null,tags:tags.get(key)||[],resolution:resolution(resolutions.get(key)),...(withHistory?{resolutionHistory:histories[index]}:{}),contact,agent,agent_id:agent?.id,ai,ai_id:ai?.id||null,metadata:{suggestions:suggestions(generation.get(key))},last_message_at:last?.created_at||null,last_message:last||null,created_at:iso(row.created_at),updated_at:iso(row.updated_at),resolved_at:iso(row.resolved_at),unread_contact_messages_count:unread.get(key)||0,participants:(participants.get(key)||[]).map((p:any)=>participantData(p,{id:p.participant_id,conversation_id:row.id,joined_via:p.participant_joined_via}))}
 })
}
export async function conversationData(env:Env,row:any,userId:string,withHistory=false){return (await conversationsData(env,[row],userId,withHistory))[0]}
