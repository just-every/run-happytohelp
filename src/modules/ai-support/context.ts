import {selectedProcedure} from './procedures'
import {assistanceProfileSql,replyProfileSql} from './selection'
import type { Env } from '../../platform/env'
import {repositoryTools} from './repository-tools'
import {contextTools} from './tools'
import type {PublicReference} from '../knowledge/public-sources'
import { getContextPacket } from '../customer-context/service'
// @ts-ignore Retained JavaScript source with original regression coverage.
import { boundTimeline,boundActivity } from './assist/packetBounds.js'
// @ts-ignore Retained packet formatting.
import { customerReplyPacket } from './replies/packet.js'
export async function replyContext(env:Env,projectId:string,conversationId:string,audience:'agent'|'contact'='contact',generationId?:string){
 const conversation=await env.DB.prepare('SELECT * FROM conversations WHERE id=? AND project_id=?').bind(conversationId,projectId).first<any>()
 if(!conversation)throw new Error('Conversation not found')
 const [project,customer,rows,notes,profile,customerContext]=await Promise.all([
 env.DB.prepare('SELECT id,name FROM projects WHERE id=?').bind(projectId).first(),
 env.DB.prepare('SELECT id,name,email FROM contacts WHERE id=? AND project_id=?').bind(conversation.contact_id,projectId).first(),
 env.DB.prepare('SELECT id,actor_role,content,created_at,revision FROM messages WHERE conversation_id=? AND project_id=? ORDER BY revision DESC LIMIT 100').bind(conversationId,projectId).all<any>(),
 env.DB.prepare('SELECT n.id,n.content,n.created_at FROM conversation_notes n JOIN conversations c ON c.id=n.conversation_id WHERE c.id=? AND c.project_id=? ORDER BY n.created_at DESC LIMIT 40').bind(conversationId,projectId).all<any>(),
 env.DB.prepare(`SELECT a.id,a.name,a.prompt,a.model,a.avatar_url FROM conversations c JOIN ai_profiles a ON a.id=${audience==='agent'?assistanceProfileSql:replyProfileSql} WHERE c.id=? AND a.project_id=? AND a.is_enabled=1`).bind(conversationId,projectId).first<any>(),
 getContextPacket(env,projectId,conversation.contact_id)])
 if(!profile)throw new Error('CONFIGURATION_REQUIRED: enabled selected conversation AI')
 const timeline=rows.results.reverse().map(m=>({kind:'message',evidence_id:`message:${m.id}`,id:m.id,role:m.actor_role,content:m.content,created_at:m.created_at,visibility:'customer-conversation'}))
 const privateNotes=notes.results.reverse().map(n=>({...n,evidence_id:`note:${n.id}`,visibility:'private-to-operators'}))
 const activity=customerContext.consent?customerContext.evidence.map(e=>({...e,evidence_id:`context:${e.id}`})):[]
 const procedure=await selectedProcedure(env,projectId,conversationId,generationId)
 if(procedure&&procedure.model!==profile.model)throw new Error('PROCEDURE_MODEL_CHANGED: review the selected assistant model')
 const policies=profile?.prompt?[profile.prompt]:[]
 if(procedure)policies.push(procedure.instructions)
 const packet=customerReplyPacket({assistPacket:{company:project,customer,conversation,timeline:boundTimeline(timeline),private_notes:boundTimeline(privateNotes),activity:boundActivity(activity),summaries:[],knowledge:{readiness:'search-required',catalog:[]},history_window:{entries:timeline.length,has_earlier:timeline.length===100}}})
 packet.capabilities={account_mutations:[],retrieval:['search_knowledge','read_knowledge_source','cite_knowledge','read_conversation_entry','read_conversation_history','search_conversation_history'],repository_retrieval:[]}
 const evidenceIds=new Set([...timeline,...privateNotes,...activity].map(entry=>entry.evidence_id))
 const repoTools=await repositoryTools(env,projectId,audience,evidenceIds)
 const publicSources=new Map<string,PublicReference>(),selectedCitations:PublicReference[]=[]
 const tools=[...contextTools(env,projectId,conversationId,evidenceIds,publicSources,selectedCitations,generationId),...repoTools].filter(tool=>!procedure||procedure.tools.includes(tool.definition.function.name))
 packet.capabilities.repository_retrieval=repoTools.map(tool=>tool.definition.function.name)
 const assistPacket={company:project,customer,conversation,timeline:boundTimeline(timeline),private_notes:boundTimeline(privateNotes),activity:boundActivity(activity),summaries:[],knowledge:{readiness:'search-required',catalog:[]},capabilities:{account_mutations:[],retrieval:['search_knowledge','read_knowledge_source','cite_knowledge','read_conversation_entry','read_conversation_history','search_conversation_history'],repository_retrieval:repoTools.map(tool=>tool.definition.function.name)},drafting_identity:{kind:'human-operator'},history_window:{entries:timeline.length,has_earlier:timeline.length===100}}
 return {conversation,packet,tools,selectedCitations,assistPacket,evidenceIds,policies,agent:{id:profile.id,is_ai:true,name:profile.name,ai:{id:profile.id,name:profile.name,avatar_url:profile?.avatar_url||null}}}
}
