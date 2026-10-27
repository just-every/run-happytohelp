import {ProviderRefusal} from './providers/types'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {auditStatement,requestSource} from '../audit/record'
import {escalationAccess,string} from './access'
import {prefix,loadConnection,provider} from './connections'
import {selectedContext,shareContext} from './context'
import {saveIssue,ticketEscalations} from './issues'
import {createIssue,getIssue,addTicketLink,postSlack,postTeams} from './providers'
export const ticketPrefix=prefix+'/conversations/:conversationId'
export const actionRoutes=new Hono<AppEnv>()
actionRoutes.get(ticketPrefix,async c=>{const {actor,conversation}=await escalationAccess(c);return c.json({data:await ticketEscalations(c.env,actor.projectId,conversation.id)})})
actionRoutes.post(ticketPrefix+'/preview',async c=>{const {actor,conversation}=await escalationAccess(c,'conversations.manage'),body=await c.req.json(),context=await selectedContext(c.env,actor.projectId,conversation.id,body);return c.json({data:{body:[`Support ticket: ${new URL(`/projects/${actor.projectId}/conversations/${conversation.id}`,c.req.url).href}`,context.body,...context.attachments.map(f=>`${f.filename} (${f.size} bytes; download link expires in 7 days)`)].filter(Boolean).join('\n\n')}})})
async function perform(c:any,handoff:'slack'|'teams'|null=null){
 const {actor,conversation}=await escalationAccess(c,'conversations.manage'),body=await c.req.json(),p=handoff??provider(body.provider),slack=!!handoff
 if(!slack&&['slack','teams'].includes(p))throw new HTTPException(400)
 const {row,connection}=await loadConnection(c.env,actor.projectId,p)
 const context=await selectedContext(c.env,actor.projectId,conversation.id,body)
 const mode=slack?'slack':body.mode
 if(!['create','link','slack'].includes(mode))throw new HTTPException(400,{message:'Choose create or link'})
 const title=mode==='create'?string(body.title,'issue title',240):'',key=mode==='link'?string(body.key,'issue key',200):''
 const dependency=typeof body.dependency==='string'?body.dependency.slice(0,500):''
 const channel=handoff==='teams'?row.target:slack?string(body.channel||row.target,'Slack channel',100):''
 if(handoff==='slack'&&!/^[CG][A-Z0-9]+$/.test(channel))throw new HTTPException(400,{message:'Choose a Slack channel ID'})
 const operationId=typeof body.request_id==='string'?string(body.request_id,'request id',100):crypto.randomUUID()
 const intent=await hashToken(JSON.stringify({project:actor.projectId,ticket:conversation.id,p,mode,title,key,dependency,channel,messages:context.messageIds,attachments:context.attachmentIds}))
 const existing=await c.env.DB.prepare('SELECT * FROM escalation_operations WHERE id=?').bind(operationId).first()
 if(existing){if(existing.project_id!==actor.projectId||existing.conversation_id!==conversation.id||existing.intent_hash!==intent)throw new HTTPException(409,{message:'This request ID belongs to another action'});if(existing.state==='failed')throw new HTTPException(409,{message:'Teams refused this handoff. Reconnect and review before deliberately starting a new request.'});if(existing.state==='complete')return c.json({data:await ticketEscalations(c.env,actor.projectId,conversation.id)});throw new HTTPException(409,{message:'The provider outcome is unknown. Check the provider before deliberately linking its issue or posting again.'})}
 // Resolve a link before claiming an outbound write, so an existing many-to-many link is a read.
 const linked=mode==='link'?await getIssue(connection,key):null
 if(linked){const prior=await c.env.DB.prepare('SELECT l.id FROM escalation_links l JOIN escalation_issues i ON i.id=l.issue_id WHERE l.conversation_id=? AND i.connection_id=? AND i.provider_id=?').bind(conversation.id,row.id,linked.id).first();if(prior)return c.json({data:await ticketEscalations(c.env,actor.projectId,conversation.id)})}
 await escalationAccess(c,'conversations.manage')
 const claim=await c.env.DB.batch([c.env.DB.prepare("INSERT OR IGNORE INTO escalation_operations VALUES(?,?,?,?,?,'sending',NULL,?)").bind(operationId,actor.projectId,conversation.id,p,intent,Date.now()),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'escalation.share_started',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'escalation_operation',id:operationId},detail:{provider:p,messages:context.messageIds.length,attachments:context.attachmentIds.length,mode}},Date.now(),{sql:'changes()=1',params:[]})])
 if(!claim[0].meta.changes)throw new HTTPException(409,{message:'This request is already being processed. Refresh its outcome; do not post again.'})
 let remoteUrl:string|null=null
 try{
  const url=new URL(`/projects/${encodeURIComponent(actor.projectId)}/conversations/${encodeURIComponent(conversation.id)}`,c.req.url).href
  const shared=await shareContext(c.env,actor.projectId,conversation.id,operationId,context,c.req.url),outgoing=[`Support ticket: ${url}`,shared].filter(Boolean).join('\n\n')
  if(slack){await escalationAccess(c,'conversations.manage');const fresh=await loadConnection(c.env,actor.projectId,p);if(fresh.row.token_cipher!==row.token_cipher||fresh.row.target!==row.target||fresh.row.installed_by!==row.installed_by)throw new Error('Connection changed');const posted=handoff==='teams'?await postTeams(fresh.connection,{body:outgoing}):await postSlack(fresh.connection,{channel,body:outgoing});remoteUrl=posted.url;await escalationAccess(c,'conversations.manage');await c.env.DB.prepare('INSERT INTO escalation_handoffs VALUES(?,?,?,?,?,?)').bind(operationId,actor.projectId,conversation.id,channel,posted.url,Date.now()).run()}
  else{
   const issue=linked??await createIssue(connection,{title,body:outgoing});remoteUrl=issue.url
   if(linked)await addTicketLink(connection,issue,{url,body:shared})
   const issueId=await saveIssue(c.env,actor.projectId,row.id,p,issue)
   await escalationAccess(c,'conversations.manage')
   await c.env.DB.prepare('INSERT OR IGNORE INTO escalation_links(id,project_id,conversation_id,issue_id,dependency,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.projectId,conversation.id,issueId,dependency,Date.now()).run()
  }
  await c.env.DB.batch([c.env.DB.prepare("UPDATE escalation_operations SET state='complete',remote_url=? WHERE id=?").bind(remoteUrl,operationId),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:slack?`escalation.${handoff}_handoff`:'escalation.linked',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'escalation_operation',id:operationId},detail:{provider:p}})])
  return c.json({data:await ticketEscalations(c.env,actor.projectId,conversation.id)},201)
 }catch(error){const refused=error instanceof ProviderRefusal;await c.env.DB.batch([c.env.DB.prepare("UPDATE escalation_operations SET state=?,remote_url=? WHERE id=?").bind(refused?'failed':'uncertain',remoteUrl,operationId),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:refused?'escalation.share_refused':'escalation.share_uncertain',outcome:'failed',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'escalation_operation',id:operationId},detail:{provider:p}})]);throw new HTTPException(502,{message:refused?'Teams refused this handoff. Reconnect and review before deliberately starting a new request.':'The provider outcome is unknown. Check the provider before posting again. Any created issue can be linked explicitly.'})}
}
actionRoutes.post(ticketPrefix+'/links',c=>perform(c))
actionRoutes.post(ticketPrefix+'/slack',c=>perform(c,'slack'))
actionRoutes.post(ticketPrefix+'/teams',c=>perform(c,'teams'))
actionRoutes.post(ticketPrefix+'/links/:linkId/recovery',async c=>{
 const {actor,conversation}=await escalationAccess(c,'conversations.manage'),body=await c.req.json(),observation=string(body.observation,'customer recovery observation',2000),id=c.req.param('linkId')
 if(!id)throw new HTTPException(404)
 const link=await c.env.DB.prepare('SELECT id FROM escalation_links WHERE id=? AND project_id=? AND conversation_id=?').bind(id,actor.projectId,conversation.id).first();if(!link)throw new HTTPException(404)
 await c.env.DB.batch([c.env.DB.prepare("UPDATE escalation_links SET recovery='observed',observation=? WHERE id=?").bind(observation,id),auditStatement(c.env.DB,{projectId:actor.projectId,category:'approval',action:'escalation.recovery_observed',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'escalation_link',id}})])
 return c.json({data:await ticketEscalations(c.env,actor.projectId,conversation.id)})
})
