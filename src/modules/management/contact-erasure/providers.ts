import type {Env} from '../../../platform/env'
import {emailConfigured} from '../../integrations/email'
import {emailMode} from '../../integrations/email-provider'

/**
 * After local erasure commits, ask each connected provider to delete what it holds,
 * as far as it can. Webhook destinations receive a signed `contact.erased` request
 * through the normal delivery queue (the contact's opaque id and the business's own
 * external id only); its delivery outcome is the request's outcome. Providers with no
 * deletion interface are recorded as unsupported, saying what stays with them. Nothing
 * here claims that sent mail, posted messages or offline copies were recalled.
 */
export function providerErasureStatements(env:Env,request:{projectId:string;contactId:string;externalId:string|null;now:number;usedAi:boolean;usedComputers:boolean}){
 const db=env.DB,{projectId,contactId,now}=request,eventId=`erased:${projectId}:${contactId}:${now}`
 const unsupported=(store:string,detail:string)=>db.prepare("INSERT OR IGNORE INTO erasure_requests(id,project_id,contact_id,store,destination_id,state,detail,requested_at,settled_at) VALUES(?,?,?,?,'','unsupported',?,?,?)").bind(crypto.randomUUID(),projectId,contactId,store,detail,now,now)
 const statements=[
  db.prepare("INSERT INTO native_integration_events(id,project_id,event,body,created_at) SELECT ?,?,'contact.erased',json_object('contact_id',?,'external_id',?),? WHERE EXISTS(SELECT 1 FROM native_integration_destinations WHERE project_id=? AND kind='webhook' AND enabled=1)").bind(eventId,projectId,contactId,request.externalId,now,projectId),
  // Every enabled webhook may hold this customer's data, subscribed to the event or not.
  db.prepare("INSERT OR IGNORE INTO native_integration_intents(id,project_id,event_id,destination_id) SELECT lower(hex(randomblob(16))),project_id,?,id FROM native_integration_destinations WHERE project_id=? AND kind='webhook' AND enabled=1 AND EXISTS(SELECT 1 FROM native_integration_events WHERE id=?)").bind(eventId,projectId,eventId),
  db.prepare("INSERT OR REPLACE INTO erasure_requests(id,project_id,contact_id,store,destination_id,state,detail,requested_at) SELECT i.id,i.project_id,?,'webhook',i.destination_id,'pending','Deletion request queued to '||d.name,? FROM native_integration_intents i JOIN native_integration_destinations d ON d.id=i.destination_id WHERE i.event_id=? AND i.project_id=?").bind(contactId,now,eventId,projectId),
  db.prepare("INSERT OR IGNORE INTO erasure_requests(id,project_id,contact_id,store,destination_id,state,detail,requested_at,settled_at) SELECT lower(hex(randomblob(16))),project_id,?,'slack',id,'unsupported','Slack messages already posted to '||name||' are not recalled. Delete them in Slack.',?,? FROM native_integration_destinations WHERE project_id=? AND kind='slack'").bind(contactId,now,now,projectId),
 ]
 if(emailConfigured(env)&&emailMode(env)!=='local')statements.push(unsupported('email_provider','Email already sent stays in the recipients’ mailboxes, and your email provider keeps its delivery logs for its own retention period.'))
 if(request.usedAi)statements.push(unsupported('ai_provider','Conversation text sent to your AI provider for AI assistance or triage is kept under that provider’s retention policy and cannot be recalled from here.'))
 if(request.usedComputers)statements.push(unsupported('local_computers','Files a paired computer downloaded for delegated work stay on that computer. Delete them there.'))
 return statements
}

export interface ProviderRequest {id:string;store:string;destination_id:string|null;state:'pending'|'completed'|'failed'|'unsupported';detail:string;requested_at:number}
/** Each request with its current outcome: a webhook request follows its delivery. */
export async function providerRequests(env:Env,projectId:string,contactId:string){
 const rows=(await env.DB.prepare(`SELECT r.id,r.store,r.destination_id,r.detail,r.requested_at,
  CASE WHEN r.store<>'webhook' THEN r.state WHEN d.state='accepted' THEN 'completed' WHEN d.state='rejected' OR i.error_code IS NOT NULL THEN 'failed' ELSE 'pending' END state,
  d.state delivery_state
  FROM erasure_requests r LEFT JOIN native_integration_intents i ON i.id=r.id AND i.project_id=r.project_id LEFT JOIN integration_deliveries d ON d.namespace=r.project_id AND d.id=r.id
  WHERE r.project_id=? AND r.contact_id=? ORDER BY r.requested_at,r.store`).bind(projectId,contactId).all<ProviderRequest&{delivery_state:string|null}>()).results
 const requests=rows.map(({delivery_state,...row})=>({...row,detail:row.store==='webhook'&&delivery_state==='uncertain'?`${row.detail}; the destination’s answer was lost, so the outcome is unknown and it is not resent automatically.`:row.detail}))
 const counts={completed:0,pending:0,failed:0,unsupported:0}
 for(const row of requests)counts[row.state]++
 return {requests,counts}
}
