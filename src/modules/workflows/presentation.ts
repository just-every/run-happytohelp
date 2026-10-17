import type {Env} from '../../platform/env'
/** Bulk read for an inbox page; SLA calculation is performed by durable work. */
export async function workflowPresentation(env:Env,rows:any[]){
 if(!rows.length)return new Map<string,any>()
 const ids=JSON.stringify(rows.map(r=>r.id)),[states,snoozes]=await env.DB.batch<any>([
  env.DB.prepare('SELECT conversation_id,state_json FROM ticket_sla_state WHERE conversation_id IN (SELECT value FROM json_each(?))').bind(ids),
  env.DB.prepare("SELECT conversation_id,due_at,dependency_id FROM workflow_schedules WHERE kind='snooze' AND state='pending' AND conversation_id IN (SELECT value FROM json_each(?))").bind(ids)
 ])
 const data=new Map<string,any>(rows.map(row=>[row.id,{workflow_sla:null,snooze:null}]))
 for(const row of states.results){const state=JSON.parse(row.state_json),clocks=state.clocks.filter((clock:any)=>clock.completed_at===null).sort((a:any,b:any)=>(a.due_at??Infinity)-(b.due_at??Infinity));data.get(row.conversation_id).workflow_sla={due_at:clocks[0]?.due_at??null,metric:clocks[0]?.metric??null,pause_reason:state.pause_reason,breached:clocks.some((clock:any)=>clock.breached)}}
 for(const row of snoozes.results)data.get(row.conversation_id).snooze=row
 return data
}
