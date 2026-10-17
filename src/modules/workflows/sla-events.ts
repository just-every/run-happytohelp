import type {Env} from '../../platform/env'
import type {SlaEvent} from './sla-clocks'

export const customerSlaMessageSql=(conversation='c')=>`EXISTS(SELECT 1 FROM messages customer_message LEFT JOIN message_authorship customer_authorship ON customer_authorship.message_id=customer_message.id WHERE customer_message.project_id=${conversation}.project_id AND customer_message.conversation_id=${conversation}.id AND customer_message.actor_role='contact' AND COALESCE(customer_authorship.source_kind,'')<>'insight')`

/** Old tickets retain their real message and status boundaries. Once installed,
 * the journal is authoritative; duplicate message/history evidence is omitted. */
export async function slaEvents(env:Env,ticket:any,now:number):Promise<SlaEvent[]>{
 const [journal,messages,history]=await Promise.all([
  env.DB.prepare("SELECT e.id,e.at,e.kind,e.before_json,CASE WHEN a.source_kind='insight' OR json_extract(e.after_json,'$.actor_role')='system' THEN json_set(e.after_json,'$.is_note',1) ELSE e.after_json END after_json FROM workflow_events e LEFT JOIN message_authorship a ON a.message_id=json_extract(e.after_json,'$.message_id') WHERE e.project_id=? AND e.conversation_id=? AND e.at<=? ORDER BY e.at,e.id").bind(ticket.project_id,ticket.id,now).all<SlaEvent>(),
  env.DB.prepare("SELECT m.id,m.created_at,m.actor_role FROM messages m LEFT JOIN message_authorship a ON a.message_id=m.id WHERE m.project_id=? AND m.conversation_id=? AND m.created_at<=? AND m.actor_role<>'system' AND COALESCE(a.source_kind,'')<>'insight' ORDER BY m.created_at,m.revision").bind(ticket.project_id,ticket.id,now).all<any>(),
  env.DB.prepare('SELECT id,at,changes_json FROM ticket_history WHERE project_id=? AND conversation_id=? AND at<=? ORDER BY at,id').bind(ticket.project_id,ticket.id,now).all<any>()
 ])
 const events:SlaEvent[]=[],journalMessageIds=new Set<string>(),statusTimes=new Set<number>()
 for(const event of journal.results){
  const after=JSON.parse(event.after_json)
  if(after.message_id)journalMessageIds.add(after.message_id)
  if(JSON.parse(event.before_json??'{}').status_category!==after.status_category)statusTimes.add(event.at)
 }
 const firstJournal=journal.results.reduce((earliest,event)=>Math.min(earliest,event.at),Infinity)
 const oldHistory=history.results.filter(h=>h.at<=firstJournal&&!statusTimes.has(h.at)).map(h=>({...h,changes:JSON.parse(h.changes_json)})).filter(h=>h.changes.status_category&&h.changes.status_category.from!==h.changes.status_category.to)
 const initialStatus=oldHistory[0]?.changes.status_category.from??(journal.results.find(e=>e.kind==='created')?JSON.parse(journal.results.find(e=>e.kind==='created')!.after_json).status_category:'new')
 if(!journal.results.some(e=>e.kind==='created'))events.push({id:0,at:ticket.created_at,kind:'created',before_json:'{}',after_json:JSON.stringify({status_category:initialStatus})})
 let sequence=-1000000
 for(const message of messages.results)if(!journalMessageIds.has(message.id)&&message.created_at<=firstJournal)events.push({id:sequence++,at:message.created_at,kind:message.actor_role==='contact'?'customer_reply':'operator_reply',before_json:'{}',after_json:JSON.stringify({message_id:message.id})})
 for(const h of oldHistory)events.push({id:sequence++,at:h.at,kind:'changed',before_json:JSON.stringify({status_category:h.changes.status_category.from}),after_json:JSON.stringify({status_category:h.changes.status_category.to})})
 if(ticket.resolved_at!=null&&ticket.resolved_at<=now&&!events.some(e=>e.at===ticket.resolved_at&&JSON.parse(e.after_json).status_category==='solved')&&!journal.results.some(e=>e.at===ticket.resolved_at&&['solved','closed'].includes(JSON.parse(e.after_json).status_category)))events.push({id:sequence++,at:ticket.resolved_at,kind:'changed',before_json:'{}',after_json:JSON.stringify({status_category:'solved'})})
 events.push(...journal.results)
 // Creation precedes same-timestamp message admission; old message revision
 // order is retained, then status transitions, then the durable journal order.
 return events.sort((a,b)=>a.at-b.at||(a.kind==='created'?-1:b.kind==='created'?1:a.id-b.id))
}
