import type {Env} from '../../platform/env'
/** The command identity remains stable across an uncertain HTTP response. The
 * original ticket is the authorization target throughout the committing batch. */
export async function followupId(projectId:string,originalId:string,actorId:string,localId:string){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([projectId,originalId,actorId,localId])))
 return 'followup-'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')
}
export function createFollowupStatement(env:Env,input:{id:string;now:number;actorId:string;predicates:string[];args:unknown[]}){
 return env.DB.prepare(`INSERT OR IGNORE INTO conversations(id,project_id,contact_id,created_at,updated_at,status_id,status_category,subject,priority,channel,brand_id,group_id,requester_id,submitter_id,submitter_type,ticket_actor_id,ticket_actor_type,ticket_source) SELECT ?,c.project_id,c.contact_id,?,?,'new','new',c.subject,c.priority,c.channel,c.brand_id,c.group_id,c.requester_id,?,'contact',?,'contact','customer_reply' FROM conversations c WHERE ${input.predicates.join(' AND ')}`).bind(input.id,input.now,input.now,input.actorId,input.actorId,...input.args)
}
export function carryFollowupStatements(env:Env,input:{id:string;originalId:string;messageId:string;actorId:string;localId:string;now:number}){
 const accepted='EXISTS(SELECT 1 FROM messages WHERE id=? AND conversation_id=?)',params=[input.messageId,input.id]
 return [
  env.DB.prepare(`INSERT OR IGNORE INTO ticket_followups(id,project_id,original_id,conversation_id,command_key,created_at) SELECT ?,c.project_id,?,?,?,? FROM conversations c WHERE c.id=? AND ${accepted}`).bind(input.id,input.originalId,input.id,input.actorId+':'+input.localId,input.now,input.id,...params),
  env.DB.prepare(`INSERT OR IGNORE INTO conversation_participants(id,conversation_id,contact_id,created_at) SELECT lower(hex(randomblob(16))),?,cp.contact_id,? FROM conversation_participants cp JOIN contacts ct ON ct.id=cp.contact_id WHERE cp.conversation_id=? AND coalesce(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND coalesce(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND coalesce(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1 AND ${accepted}`).bind(input.id,input.now,input.originalId,...params),
  env.DB.prepare(`INSERT OR IGNORE INTO conversation_tags(project_id,conversation_id,tag_id) SELECT project_id,?,tag_id FROM conversation_tags WHERE conversation_id=? AND ${accepted}`).bind(input.id,input.originalId,...params),
  env.DB.prepare(`INSERT OR IGNORE INTO ticket_field_values(project_id,conversation_id,field_id,value_json) SELECT project_id,?,field_id,value_json FROM ticket_field_values WHERE conversation_id=? AND ${accepted}`).bind(input.id,input.originalId,...params),
  env.DB.prepare(`INSERT OR IGNORE INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,c.project_id,?,'data','ticket.followup.created','succeeded','system',?,'system','conversation',c.id,json_object('original_id',?) FROM conversations c WHERE c.id=? AND ${accepted}`).bind('followup:'+input.id,input.now,input.actorId,input.originalId,input.id,...params),
 ]
}
