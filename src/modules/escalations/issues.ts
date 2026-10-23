import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import type {Issue,Provider} from './providers'
export async function saveIssue(env:Env,projectId:string,connectionId:string,provider:Provider,issue:Issue){
 if(!issue.id||!Number.isFinite(issue.updatedAt)||!/^https?:\/\//.test(issue.url))throw new HTTPException(502,{message:'Provider returned an invalid issue'})
 const id=connectionId+':'+issue.id
 await env.DB.prepare(`INSERT INTO escalation_issues(id,project_id,connection_id,provider,provider_id,issue_key,url,status,assignee,closed,provider_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(connection_id,provider_id) DO UPDATE SET issue_key=excluded.issue_key,url=excluded.url,status=excluded.status,assignee=excluded.assignee,closed=excluded.closed,provider_updated_at=excluded.provider_updated_at WHERE excluded.provider_updated_at>escalation_issues.provider_updated_at`).bind(id,projectId,connectionId,provider,issue.id,issue.key,issue.url,issue.status,issue.assignee,issue.closed?1:0,issue.updatedAt).run()
 return id
}
export async function ticketEscalations(env:Env,projectId:string,conversationId:string){
 const [links,drafts,handoffs,messages,files,operations]=await env.DB.batch<any>([
  env.DB.prepare(`SELECT l.id,i.provider,i.issue_key key,i.url,i.status,i.assignee,l.dependency,l.recovery,l.observation FROM escalation_links l JOIN escalation_issues i ON i.id=l.issue_id WHERE l.project_id=? AND l.conversation_id=? ORDER BY l.created_at,l.id`).bind(projectId,conversationId),
  env.DB.prepare('SELECT id,content,state,message_id FROM escalation_drafts WHERE project_id=? AND conversation_id=? ORDER BY created_at,id').bind(projectId,conversationId),
  env.DB.prepare('SELECT h.id,h.channel,h.url,h.dependency,o.provider FROM escalation_handoffs h JOIN escalation_operations o ON o.id=h.id WHERE h.project_id=? AND h.conversation_id=? ORDER BY h.created_at').bind(projectId,conversationId),
  env.DB.prepare('SELECT id,content,created_at FROM messages WHERE project_id=? AND conversation_id=? AND erased_at IS NULL ORDER BY revision').bind(projectId,conversationId),
  env.DB.prepare(`SELECT id,message_id,filename,size FROM media WHERE project_id=? AND conversation_id=? AND message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_note_media n WHERE n.media_id=media.id)`).bind(projectId,conversationId),
  env.DB.prepare(`SELECT id,provider,state,remote_url FROM escalation_operations WHERE project_id=? AND conversation_id=? AND state<>'complete' ORDER BY created_at`).bind(projectId,conversationId)
 ])
 return {links:links.results,drafts:drafts.results,handoffs:handoffs.results,operations:operations.results,messages:messages.results.map(m=>({...m,attachments:files.results.filter(f=>f.message_id===m.id)}))}
}
