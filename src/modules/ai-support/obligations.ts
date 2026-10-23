import {cronRoom} from '../../platform/cron-budget'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env} from '../../platform/env'
import {requireProject} from '../../platform/auth'
import {memberAccess} from '../access/gate'
import {activeSourceProjectSql} from '../knowledge/public-sources'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {auditStatement,requestSource} from '../audit/record'

const path='/projects/:projectId/conversations/:conversationId/obligations'
const live=`${activeSourceProjectSql('c.project_id')} AND ${contactAvailableSql()}`
async function terms(env:Env,pid:string,cid:string,b:any){
 if(typeof b.ownerId!=='string'||!Number.isSafeInteger(b.dueAt)||b.dueAt<=Date.now()||b.dueAt>Date.now()+366*86400000)throw new HTTPException(400,{message:'An active owner and future due time within a year are required'})
 if(!await env.DB.prepare('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?').bind(pid,b.ownerId).first())throw new HTTPException(400,{message:'Owner must belong to this workspace'})
 if(b.dependencyId&&!await env.DB.prepare('SELECT 1 FROM escalation_links WHERE project_id=? AND conversation_id=? AND issue_id=?').bind(pid,cid,b.dependencyId).first())throw new HTTPException(400,{message:'Dependency must be linked to this conversation'})
}
/** The model can propose only an exact quote in this conversation, never accept,
 * send or claim progress. Human acceptance confirms the meaning and due time. */
export async function proposeObligation(env:Env,pid:string,cid:string,b:any){
 if(b.ownerId==='human'){
  const user=await env.DB.prepare("SELECT user_id FROM memberships WHERE project_id=? ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,user_id LIMIT 1").bind(pid).first<{user_id:string}>()
  if(!user)throw new HTTPException(409,{message:'No responsible teammate is available'})
  b={...b,ownerId:user.user_id}
 }
 await terms(env,pid,cid,b)
 if(typeof b.quote!=='string'||!b.quote.trim()||b.quote.length>2000||typeof b.stopCondition!=='string'||!b.stopCondition.trim()||b.stopCondition.length>500)throw new HTTPException(400,{message:'An exact message quote and stop condition are required'})
 const source=await env.DB.prepare(`SELECT m.content FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE m.id=? AND c.id=? AND c.project_id=? AND m.actor_role IN ('contact','operator','admin','owner','ai') AND ${live}`).bind(b.messageId,cid,pid).first<{content:string}>()
 const index=source?.content.indexOf(b.quote)??-1
 if(index<0)throw new HTTPException(400,{message:'Quote is not present in this conversation message'})
 const start=Array.from(source!.content.slice(0,index)).length,end=start+Array.from(b.quote).length
 const id=crypto.randomUUID(),now=Date.now()
 const result=await env.DB.prepare(`INSERT INTO followup_obligations(id,project_id,conversation_id,message_id,quote_start,quote_end,owner_id,due_at,stop_condition,dependency_id,created_at,updated_at) SELECT ?,c.project_id,c.id,?,?,?,?,?,?,?,?,? FROM conversations c WHERE c.id=? AND c.project_id=? AND ${live} AND EXISTS(SELECT 1 FROM messages WHERE id=? AND conversation_id=c.id AND content=?) AND EXISTS(SELECT 1 FROM memberships WHERE project_id=c.project_id AND user_id=?) AND NOT EXISTS(SELECT 1 FROM followup_obligations WHERE project_id=c.project_id AND conversation_id=c.id AND message_id=? AND quote_start=? AND quote_end=?)`).bind(id,b.messageId,start,end,b.ownerId,b.dueAt,b.stopCondition,b.dependencyId||null,now,now,cid,pid,b.messageId,source!.content,b.ownerId,b.messageId,start,end).run()
 if(!result.meta.changes){const prior=await env.DB.prepare('SELECT id,state FROM followup_obligations WHERE project_id=? AND conversation_id=? AND message_id=? AND quote_start=? AND quote_end=?').bind(pid,cid,b.messageId,start,end).first<{id:string;state:string}>();if(prior)return {...prior,duplicate:true,requiresHumanAcceptance:prior.state==='proposed'};throw new HTTPException(409,{message:'Source or authority changed'})}
 return {id,state:'proposed',requiresHumanAcceptance:true}
}
const evidenceSql=`SELECT o.*,substr(m.content,o.quote_start+1,o.quote_end-o.quote_start) quote,
 i.issue_key,i.url dependency_url,i.closed,
 (SELECT max(d.received_at) FROM escalation_deliveries d WHERE d.issue_id=i.id AND d.provider_updated_at=i.provider_updated_at) readback_at,
 (SELECT l.recovery FROM escalation_links l WHERE l.conversation_id=o.conversation_id AND l.issue_id=i.id) recovery
 FROM followup_obligations o JOIN messages m ON m.id=o.message_id AND m.project_id=o.project_id
 JOIN conversations c ON c.id=o.conversation_id AND c.project_id=o.project_id
 LEFT JOIN escalation_issues i ON i.id=o.dependency_id AND i.project_id=o.project_id`
function present(row:any){
 const stale=!!row.dependency_id&&(!row.readback_at||row.readback_at<Date.now()-86400000)
 const observed=!!row.dependency_id&&!stale&&row.closed===1&&row.recovery==='observed'
 return {...row,dependency:{id:row.dependency_id,stale,readbackAt:row.readback_at||null,progress:observed?'recovery observed':'unconfirmed'},
  reminderDue:row.state==='open'&&(row.due_at<=Date.now()+86400000||stale),
  draft:row.state==='open'&&row.due_at<=Date.now()+86400000?{content:observed?'We have observed recovery on the linked work. Please let us know if the problem continues.':'Your follow-up is due. We do not yet have current evidence confirming progress or recovery; we are checking with the responsible teammate.',requiresHumanSend:true}:null}
}
export const obligationRoutes=new Hono<AppEnv>()
obligationRoutes.use(path+'*',async(c,next)=>{
 const pid=c.req.param('projectId')!,actor=await requireProject(c,pid,true)
 if(!(await memberAccess(c.env.DB,pid,actor.id))?.permissions.has('conversations.manage'))throw new HTTPException(403,{message:'Conversation management permission required'})
 if(!await c.env.DB.prepare(`SELECT 1 FROM conversations c WHERE c.id=? AND c.project_id=? AND ${live}`).bind(c.req.param('conversationId')!,pid).first())throw new HTTPException(404)
 c.header('Cache-Control','private, no-store');await next()
})
obligationRoutes.get(path,async c=>{
 const rows=await c.env.DB.prepare(`${evidenceSql} WHERE o.project_id=? AND o.conversation_id=? AND ${live} ORDER BY o.due_at,o.id`).bind(c.req.param('projectId')!,c.req.param('conversationId')!).all<any>()
 const obligations=[]
 for(const row of rows.results){const changes=await c.env.DB.prepare('SELECT version,owner_id,due_at,accepted_by,accepted_at FROM followup_changes WHERE obligation_id=? ORDER BY version').bind(row.id).all();const completion=await c.env.DB.prepare("SELECT actor_id reviewerId,at,json_extract(detail_json,'$.confirmationMessageId') confirmationMessageId FROM audit_events WHERE project_id=? AND target_type='obligation' AND target_id=? AND action='followup.completed' ORDER BY at DESC,id DESC LIMIT 1").bind(row.project_id,row.id).first();obligations.push({...present(row),changes:changes.results,completion:completion||null})}
 return c.json({obligations})
})
obligationRoutes.post(path,async c=>c.json(await proposeObligation(c.env,c.req.param('projectId')!,c.req.param('conversationId')!,await c.req.json()),201))
obligationRoutes.post(path+'/:id/accept',async c=>{
 const pid=c.req.param('projectId')!,cid=c.req.param('conversationId')!,id=c.req.param('id')!,b=await c.req.json(),actor=c.get('actor'),now=Date.now()
 await terms(c.env,pid,cid,b)
 if(!Number.isSafeInteger(b.version))throw new HTTPException(400,{message:'Current version required'})
 const receipt=crypto.randomUUID()
 const result=await c.env.DB.batch([
 c.env.DB.prepare(`UPDATE followup_obligations SET owner_id=?,due_at=?,dependency_id=CASE WHEN ?=1 THEN ? ELSE dependency_id END,state='open',accepted_by=?,accepted_at=?,updated_at=?,version=version+1 WHERE id=? AND project_id=? AND conversation_id=? AND version=? AND state IN ('proposed','open') AND EXISTS(SELECT 1 FROM memberships WHERE project_id=? AND user_id=?) AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=followup_obligations.conversation_id AND c.project_id=followup_obligations.project_id AND ${live}) AND EXISTS(SELECT 1 FROM sessions s JOIN memberships m ON m.project_id=? AND m.user_id=s.actor_id LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.project_id=m.project_id AND pr.id=mr.role_key WHERE s.token_hash=? AND s.actor_id=? AND s.revoked_at IS NULL AND s.expires_at>? AND (m.role='owner' OR (mr.role_key IS NULL AND m.role IN ('admin','operator')) OR (pr.base IN ('admin','operator') AND EXISTS(SELECT 1 FROM json_each(pr.permissions_json) WHERE value='conversations.manage'))))`).bind(b.ownerId,b.dueAt,Object.hasOwn(b,'dependencyId')?1:0,b.dependencyId||null,actor.id,now,now,id,pid,cid,b.version,pid,b.ownerId,pid,c.get('sessionHash'),actor.id,now),
 c.env.DB.prepare(`INSERT INTO followup_changes SELECT ?,id,version,owner_id,due_at,accepted_by,accepted_at FROM followup_obligations WHERE id=? AND version=? AND accepted_at=? AND accepted_by=? AND changes()>0`).bind(receipt,id,b.version+1,now,actor.id),
 auditStatement(c.env.DB,{projectId:pid,category:'data',action:'followup.accepted',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'obligation',id}},now,{sql:'EXISTS(SELECT 1 FROM followup_changes WHERE id=?)',params:[receipt]})
 ])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Obligation or authority changed'})
 return c.json({accepted:true,version:b.version+1})
})

obligationRoutes.post(path+'/:id/complete',async c=>{
 const pid=c.req.param('projectId')!,cid=c.req.param('conversationId')!,id=c.req.param('id')!,b=await c.req.json(),actor=c.get('actor'),now=Date.now()
 if(b.stopConditionMet!==true||!Number.isSafeInteger(b.version)||typeof b.confirmationMessageId!=='string'||typeof b.quote!=='string'||!b.quote.trim()||b.quote.length>2000)throw new HTTPException(400,{message:'Confirm the accepted stop condition with a fresh, exact human/customer message quote and current version'})
 const result=await c.env.DB.batch([
 c.env.DB.prepare(`UPDATE followup_obligations SET state='completed',version=version+1,updated_at=? WHERE id=? AND project_id=? AND conversation_id=? AND version=? AND state='open' AND EXISTS(SELECT 1 FROM messages m JOIN message_authorship a ON a.message_id=m.id WHERE m.id=? AND m.id<>followup_obligations.message_id AND m.project_id=followup_obligations.project_id AND m.conversation_id=followup_obligations.conversation_id AND m.created_at>=followup_obligations.accepted_at AND a.kind IN ('human','visitor') AND instr(m.content,?)>0) AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=followup_obligations.conversation_id AND c.project_id=followup_obligations.project_id AND ${live}) AND EXISTS(SELECT 1 FROM sessions s JOIN memberships m ON m.project_id=? AND m.user_id=s.actor_id LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.project_id=m.project_id AND pr.id=mr.role_key WHERE s.token_hash=? AND s.actor_id=? AND s.revoked_at IS NULL AND s.expires_at>? AND (m.role='owner' OR (mr.role_key IS NULL AND m.role IN ('admin','operator')) OR (pr.base IN ('admin','operator') AND EXISTS(SELECT 1 FROM json_each(pr.permissions_json) WHERE value='conversations.manage'))))`).bind(now,id,pid,cid,b.version,b.confirmationMessageId,b.quote,pid,c.get('sessionHash'),actor.id,now),
 auditStatement(c.env.DB,{projectId:pid,category:'data',action:'followup.completed',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'obligation',id},detail:{confirmationMessageId:b.confirmationMessageId,version:b.version+1}},now,{sql:'changes()>0',params:[]})])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Fresh completion evidence or current authority is missing'})
 return c.json({completed:true,version:b.version+1,dependencyProgress:'Completion records the accepted follow-up stop condition; engineering progress still requires its own current readback.'})
})

/** One bounded, idempotent internal reminder per accepted version. No mail or
 * customer reply is scheduled, and revoked owners receive nothing. */
export async function remindObligations(env:Env){
 if(!cronRoom(env,1))return
 const now=Date.now()
 await env.DB.prepare(`INSERT OR IGNORE INTO notification_inbox(id,project_id,conversation_id,user_id,kind,inbox,email,created_at)
 SELECT 'followup:'||o.id||':'||o.version,o.project_id,o.conversation_id,o.owner_id,'follower',1,0,?
 FROM followup_obligations o JOIN conversations c ON c.id=o.conversation_id AND c.project_id=o.project_id
 JOIN memberships m ON m.project_id=o.project_id AND m.user_id=o.owner_id
 WHERE o.state='open' AND (o.due_at<=? OR (o.dependency_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM escalation_issues i JOIN escalation_deliveries d ON d.issue_id=i.id AND d.provider_updated_at=i.provider_updated_at WHERE i.id=o.dependency_id AND i.project_id=o.project_id AND d.received_at>=?-86400000))) AND ${live} AND NOT EXISTS(SELECT 1 FROM notification_inbox n WHERE n.id='followup:'||o.id||':'||o.version)
 ORDER BY o.due_at,o.id LIMIT 25`).bind(now,now+86400000,now).run()
}
