import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {decryptToken} from '../integrations/secrets'
import {auditStatement} from '../audit/record'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {publishActivity} from '../conversations/activity'
import {parseWebhook,verifyWebhook,getIssue,type Tracker} from './providers'
import {loadConnection,type ConnectionRow} from './connections'
async function rawBody(request:Request){
 const reader=request.body?.getReader();if(!reader)return '';const chunks:Uint8Array[]=[];let size=0
 for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1048576){await reader.cancel();throw new HTTPException(413)}chunks.push(part.value)}
 const data=new Uint8Array(size);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.length}return new TextDecoder('utf-8',{fatal:true}).decode(data)
}
export const webhookRoutes=new Hono<AppEnv>()
webhookRoutes.post('/webhooks/:connectionId',async c=>{
 const connectionId=c.req.param('connectionId'),row=await c.env.DB.prepare('SELECT * FROM escalation_connections WHERE id=?').bind(connectionId).first<ConnectionRow>()
 if(!row||row.provider==='slack'||!row.webhook_cipher||!row.token_cipher)throw new HTTPException(401)
 const raw=await rawBody(c.req.raw),secret=await decryptToken(c.env,row.project_id,row.webhook_cipher)
 if(!await verifyWebhook(row.provider as Tracker,secret,c.req.raw.headers,raw)){
  await auditStatement(c.env.DB,{projectId:row.project_id,category:'integration',action:'escalation.webhook_refused',outcome:'refused',actor:{type:'system'},source:'system',target:{type:'escalation_connection',id:row.id}}).run()
  throw new HTTPException(401,{message:'Invalid provider signature'})
 }
 let payload:any;try{payload=JSON.parse(raw)}catch{throw new HTTPException(400)}
 const event=parseWebhook(row.provider as Tracker,c.req.raw.headers,payload);if(!event)return c.json({ignored:true})
 const issue=await c.env.DB.prepare('SELECT * FROM escalation_issues WHERE connection_id=? AND provider_id=?').bind(row.id,event.issue.id).first<any>()
 if(!issue)return c.json({ignored:true})
 const duplicate=await c.env.DB.prepare('SELECT 1 FROM escalation_deliveries WHERE connection_id=? AND delivery_id=?').bind(row.id,event.deliveryId).first()
 if(duplicate)return c.json({duplicate:true})
 let current=event.issue
 if(event.issue.updatedAt>issue.provider_updated_at){
  const {connection}=await loadConnection(c.env,row.project_id,row.provider)
  // Signed events may omit computed fields. Read only from the configured provider,
  // and insist that the readback names the exact linked issue.
  current=await getIssue(connection,row.provider==='linear'?event.issue.id:issue.issue_key)
  if(current.id!==event.issue.id||current.updatedAt<event.issue.updatedAt)throw new HTTPException(503,{message:'The provider has not exposed this update yet'})
 }
 const now=Date.now(),changed=current.updatedAt>issue.provider_updated_at,closedTransition=changed&&current.closed&&!issue.closed
 const receipt=c.env.DB.prepare('INSERT OR IGNORE INTO escalation_deliveries VALUES(?,?,?,?,?)').bind(row.id,event.deliveryId,issue.id,current.updatedAt,now)
 const guard=`EXISTS(SELECT 1 FROM escalation_deliveries WHERE connection_id=? AND delivery_id=?)`
 const args=[row.id,event.deliveryId]
 const update=c.env.DB.prepare(`UPDATE escalation_issues SET issue_key=?,url=?,status=?,assignee=?,closed=?,provider_updated_at=? WHERE id=? AND provider_updated_at<? AND ${guard}`).bind(current.key,current.url,current.status,current.assignee,current.closed?1:0,current.updatedAt,issue.id,current.updatedAt,...args)
 const stateGuard=`i.provider_updated_at=? AND i.id=? AND ${guard}`
 const data=await c.env.DB.batch([
  receipt,update,
  ...(closedTransition?[c.env.DB.prepare(`INSERT OR IGNORE INTO escalation_drafts(id,project_id,conversation_id,issue_id,provider_updated_at,content,created_at) SELECT lower(hex(randomblob(16))),l.project_id,l.conversation_id,l.issue_id,?,?,? FROM escalation_links l JOIN escalation_issues i ON i.id=l.issue_id JOIN conversations c ON c.id=l.conversation_id WHERE ${stateGuard} AND i.closed=1 AND ${contactAvailableSql()}`).bind(current.updatedAt,`Our engineering team has marked ${current.key} complete. Please try again and let us know whether this resolves the problem for you. We have not yet confirmed your recovery.`,now,current.updatedAt,issue.id,...args)]:[]),
  ...(changed&&!current.closed?[c.env.DB.prepare("UPDATE escalation_drafts SET state='cancelled' WHERE issue_id=? AND state IN ('draft','approved') AND EXISTS(SELECT 1 FROM escalation_issues WHERE id=? AND provider_updated_at=? AND closed=0)").bind(issue.id,issue.id,current.updatedAt)]:[]),
  ...(changed?[c.env.DB.prepare(`INSERT OR IGNORE INTO notification_inbox(id,project_id,conversation_id,user_id,kind,inbox,email,created_at) SELECT 'escalation:'||l.id||':'||?,l.project_id,c.id,c.assigned_to,'follower',1,0,? FROM escalation_links l JOIN escalation_issues i ON i.id=l.issue_id JOIN conversations c ON c.id=l.conversation_id JOIN memberships m ON m.user_id=c.assigned_to AND m.project_id=c.project_id WHERE ${stateGuard} AND ${contactAvailableSql()}`).bind(current.updatedAt,now,current.updatedAt,issue.id,...args)]:[]),
  auditStatement(c.env.DB,{projectId:row.project_id,category:'integration',action:'escalation.provider_updated',actor:{type:'system'},source:'system',target:{type:'escalation_issue',id:issue.id},detail:{provider:row.provider,advanced:changed,closed:current.closed}},now)
 ])
 if(data[1].meta.changes){const links=await c.env.DB.prepare('SELECT conversation_id FROM escalation_links WHERE issue_id=?').bind(issue.id).all<{conversation_id:string}>();await Promise.all(links.results.map(link=>publishActivity(c.env,row.project_id,link.conversation_id,'escalation')))}
 return c.json({received:true,advanced:!!data[1].meta.changes})
})
