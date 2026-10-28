import type {Env,Actor} from '../../platform/env'
import {ToolRefusal,type ToolContext,type ClassAndFacts} from '../../vendor/agent-base/modules/agent-door/index.ts'
import {memberAccess} from '../../modules/access/gate'
import {getTicket} from '../../modules/tickets/model'
import {getContextPacket} from '../../modules/customer-context/service'
import {redactRepositoryContent} from '../../modules/integrations/repository'
import {linkedProject,nativePerson} from './people.ts'
import {selectedTarget} from './local-credentials.ts'
import type {Permission} from '../../modules/access/catalogue'
export type Who=Pick<ToolContext,'person'|'clientId'|'scopes'>
export async function actorFor(env:Env,who:Who,permission?:Permission):Promise<Actor>{
 const person=await nativePerson(env,who.person.id),link=await linkedProject(env)
 if(!person||!link)throw new ToolRefusal('sponsor_unavailable')
 const access=await memberAccess(env.DB,link.project_id,person.id)
 if(!access||permission&&!access.permissions.has(permission)&&!(permission==='knowledge.read'&&access.permissions.has('knowledge.edit')))throw new ToolRefusal('not_found')
 const member=await env.DB.prepare('SELECT role FROM memberships WHERE project_id=? AND user_id=?').bind(link.project_id,person.id).first<{role:Actor['role']}>()
 if(!member)throw new ToolRefusal('not_found')
 return {id:person.id,projectId:link.project_id,role:member.role}
}
/** Redact recognizable credential material even when it was pasted into customer text. */
export function redacted<T>(input:T):T{
 if(typeof input==='string')return redactRepositoryContent(input) as T
 if(Array.isArray(input))return input.map(redacted) as T
 if(input&&typeof input==='object')return Object.fromEntries(Object.entries(input).filter(([key])=>!/(?:token|secret|password|authorization|object_key|key_hash|session)/i.test(key)).map(([key,value])=>[key,redacted(value)])) as T
 return input
}
export function readClasses(record:unknown):ClassAndFacts[]{
 const wire=JSON.stringify(record)
 const protectedContent=/\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/.test(wire)
 return protectedContent?[{class:'standard',facts:{measure:1}},{class:'sensitive',facts:{measure:1,kind:'protected-content'}}]:[{class:'standard',facts:{measure:1}}]
}
export async function conversationRead(env:Env,who:Who,id:string){
 const actor=await actorFor(env,who)
 await selectedTarget(env,who,'conversations',id)
 let ticket:any
 try{ticket=await getTicket(env,actor,id)}catch{throw new ToolRefusal('not_found')}
 const messages=await env.DB.prepare('SELECT id,content,actor_id,actor_role,revision,created_at,erased_at FROM messages WHERE project_id=? AND conversation_id=? ORDER BY revision LIMIT 1000').bind(actor.projectId,id).all()
 const media=await env.DB.prepare('SELECT id,message_id,filename,content_type,size FROM media WHERE project_id=? AND conversation_id=? AND message_id IS NOT NULL').bind(actor.projectId,id).all()
 const operations=await env.DB.prepare('SELECT tool,agent_name,sponsor_name,approvers_json,at FROM h2h_agent_operations WHERE project_id=? AND target_id=? ORDER BY at LIMIT 200').bind(actor.projectId,id).all()
 const jobs=await env.DB.prepare('SELECT id,mode,status FROM local_jobs WHERE project_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT 100').bind(actor.projectId,id).all()
 return redacted({ticket,jobs:jobs.results,messages:messages.results,attachments:media.results,activity:operations.results.map((row:any)=>({...row,label:`${row.agent_name} for ${row.sponsor_name}`,approvers:JSON.parse(row.approvers_json)}))})
}
export async function articleRead(env:Env,who:Who,id:string){
 const actor=await actorFor(env,who,'knowledge.read')
 await selectedTarget(env,who,'articles',id)
 const access=await memberAccess(env.DB,actor.projectId,actor.id)
 if(access?.knowledgeArticleIds!==null&&!access?.knowledgeArticleIds.includes(id))throw new ToolRefusal('not_found')
 const article=await env.DB.prepare('SELECT id,title,slug,content,summary,status,source_revision,source_incarnation,publication_version,updated_at FROM knowledge_articles WHERE project_id=? AND id=?').bind(actor.projectId,id).first()
 if(!article)throw new ToolRefusal('not_found')
 return redacted(article)
}
export async function contextRead(env:Env,who:Who,id:string){
 const actor=await actorFor(env,who),conversation=await conversationRead(env,who,id)
 return redacted(await getContextPacket(env,actor.projectId,conversation.ticket.contact_id))
}
export async function jobRead(env:Env,who:Who,id:string){
 const actor=await actorFor(env,who)
 const job=await env.DB.prepare('SELECT id,conversation_id,mode,status,parent_delegation_id,source_proposal_id,created_at,completed_at FROM local_jobs WHERE project_id=? AND id=?').bind(actor.projectId,id).first<any>()
 if(!job)throw new ToolRefusal('not_found')
 await selectedTarget(env,who,'conversations',job.conversation_id)
 return {...job,observation:job.status==='completed'?'Reported by connector; independent verification is separate.':'Unavailable or unconfirmed until the connector reports.'}
}
export async function operationRead(env:Env,who:Who,id:string){
 const actor=await actorFor(env,who)
 const row=await env.DB.prepare('SELECT id,tool,target_type,target_id,agent_name,sponsor_name,approvers_json,at FROM h2h_agent_operations WHERE project_id=? AND id=?').bind(actor.projectId,id).first<any>()
 if(!row)throw new ToolRefusal('not_found')
 if(row.target_type==='conversation'||row.target_type==='article')await selectedTarget(env,who,row.target_type==='article'?'articles':'conversations',row.target_id)
 else if(who.clientId?.startsWith('edition:'))throw new ToolRefusal('not_found')
 return {...row,approvers:JSON.parse(row.approvers_json),label:`${row.agent_name} for ${row.sponsor_name}`}
}
