import type {Env} from '../../platform/env'
import {trackingStatement} from '../outcomes/tracking'
import {conversationReach} from './reach'
export interface PlanFile {id:string;objectKey:string;filename:string;contentType:string;size:number;uploadId?:string}
export interface TicketPlan {body:any;credentialId:string;contactId:string;files:PlanFile[]}
/** Direct admission and operator recovery assemble the same row set from a plan. */
export function ticketStatements(env:Env,project:string,credential:any,plan:TicketPlan,input:any,options:{id:string;messageId:string;now:number;localId:string;actorId:string;actorType:'api'|'user';history:any}){
 const {id,messageId,now,localId,actorId,actorType,history}=options,b=plan.body
 return [
  env.DB.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at,subject,channel,priority,brand_id,mailbox_id,group_id,submitter_id,submitter_type,ticket_actor_id,ticket_actor_type,ticket_source,revision,last_message_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'api',?,?,'api',0,NULL)").bind(id,project,plan.contactId,now,now,input.subject,input.channel,input.priority,b.brand_id??null,b.mailbox_id??null,b.group_id??null,credential.id,actorId,actorType),
  env.DB.prepare('INSERT INTO api_conversations(conversation_id,project_id,credential_id,form_id,credential_name,source_product,source_ref,source_url) VALUES(?,?,?,?,?,?,?,?)').bind(id,project,credential.id,b.form_id??null,credential.name,credential.source_product,input.ref,input.url),
  env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM conversations c WHERE c.id=? AND c.project_id=? AND ${conversationReach()}) AND NOT EXISTS(SELECT 1 FROM json_each(?) tag WHERE NOT EXISTS(SELECT 1 FROM workspace_tags WHERE project_id=? AND id=tag.value)) THEN 1 ELSE 0 END`).bind(id,project,credential.id,JSON.stringify(input.tags),project),
  env.DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,?,'contact',?,1,?)").bind(messageId,project,id,localId,plan.contactId,input.content,now),
  ...input.tags.map((tag:string)=>env.DB.prepare('INSERT INTO conversation_tags VALUES(?,?,?)').bind(project,id,tag)),
  ...plan.files.map(file=>env.DB.prepare('INSERT INTO media VALUES(?,?,?,?,?,?,?,?,?,?)').bind(file.id,project,id,plan.contactId,file.objectKey,file.filename,file.contentType,file.size,messageId,now)),
  trackingStatement(env,id,true),
  env.DB.prepare('UPDATE conversations SET revision=1,last_message_id=? WHERE id=? AND project_id=?').bind(messageId,id,project),
  env.DB.prepare('INSERT INTO conversation_outbox(project_id,conversation_id,message_id,created_at,delivered_at) VALUES(?,?,?,?,?)').bind(project,id,messageId,now,actorType==='user'?now:null),
  env.DB.prepare("INSERT INTO ticket_history VALUES(?,?,?,?,?,'api',?,?)").bind(crypto.randomUUID(),project,id,actorId,actorType,now,JSON.stringify({...history,credential_id:credential.id,credential_name:credential.name,source_product:credential.source_product,source_ref:input.ref})),
 ]
}

/** The requester row is identical whether admission is immediate or held. */
export function requesterStatements(env:Env,project:string,credential:any,plan:TicketPlan,input:any,now:number){
 return input.contact?[]:[env.DB.prepare('INSERT INTO contacts(id,project_id,name,email,external_id,is_verified,metadata_json,created_at) VALUES(?,?,?,?,?,0,?,?)').bind(plan.contactId,project,input.name,input.email,null,JSON.stringify({api_asserted_by:credential.id,api_source:credential.source_product,api_external_id:input.external,...(input.phone?{phone:input.phone}:{})}),now)]
}
