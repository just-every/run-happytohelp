import type {Env} from '../../platform/env'
import {syncSlaTickets} from './sla'
/** Rule/schedule changes feed SLA clocks but cannot start another rule chain. The
 * refresh is a fixed-cost batch, rather than a new per-event execution backlog. */
export async function processGeneratedEvents(env:Env,now:number){
 let rows=(await env.DB.prepare(`SELECT id,project_id,conversation_id,attempts FROM (SELECT e.id,e.project_id,e.conversation_id,e.attempts,coalesce(q.turn,0) served,row_number() OVER (PARTITION BY e.project_id ORDER BY e.id) turn FROM workflow_events e LEFT JOIN workflow_queue_turns q ON q.queue='event-refresh' AND q.project_id=e.project_id WHERE e.state='pending' AND e.source IN ('rule','automation','schedule','rer') AND coalesce(e.next_attempt_at,0)<=?1 AND coalesce(e.lease_until,0)<=?1) ORDER BY turn,served,id LIMIT 40`).bind(now).all<{id:number;project_id:string;conversation_id:string;attempts:number}>()).results
 if(!rows.length)return
 rows=rows.filter(row=>row.project_id===rows[0].project_id)
 const exhausted=rows.filter(row=>row.attempts>=5)
 if(exhausted.length){await env.DB.prepare("UPDATE workflow_events SET state='not_routed',next_attempt_at=NULL,error='SLA refresh was interrupted. Stopped after 5 attempts' WHERE state='pending' AND id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(exhausted.map(row=>row.id))).run();rows=rows.filter(row=>row.attempts<5)}
 if(!rows.length)return
 const ids=JSON.stringify(rows.map(row=>row.id)),lease=crypto.randomUUID()
 await env.DB.prepare("INSERT INTO workflow_queue_turns(queue,project_id,turn) SELECT 'event-refresh',value,(SELECT coalesce(max(turn),0)+1 FROM workflow_queue_turns WHERE queue='event-refresh') FROM json_each(?) WHERE true ON CONFLICT(queue,project_id) DO UPDATE SET turn=excluded.turn").bind(JSON.stringify([...new Set(rows.map(row=>row.project_id))])).run()
 await env.DB.prepare("UPDATE workflow_events SET lease_token=?,lease_until=?,attempts=attempts+1 WHERE state='pending' AND id IN (SELECT value FROM json_each(?)) AND coalesce(lease_until,0)<=?").bind(lease,now+120000,ids,now).run()
 try{
  await syncSlaTickets(env,[...new Set(rows.map(row=>row.conversation_id))],now)
  await env.DB.prepare("UPDATE workflow_events SET state='complete',error=NULL,attempts=max(0,attempts-1),lease_token=NULL,lease_until=NULL,next_attempt_at=NULL WHERE state='pending' AND lease_token=?").bind(lease).run()
 }catch(error){
  const reason=error instanceof Error?error.message.slice(0,1000):'SLA refresh failed'
  await env.DB.prepare("UPDATE workflow_events SET state=CASE WHEN attempts>=5 THEN 'not_routed' ELSE 'pending' END,error=?||CASE WHEN attempts>=5 THEN '. Stopped after 5 attempts' ELSE '' END,next_attempt_at=CASE WHEN attempts>=5 THEN NULL ELSE ?+CASE attempts WHEN 1 THEN 60000 WHEN 2 THEN 300000 WHEN 3 THEN 900000 ELSE 3600000 END END,lease_token=NULL,lease_until=NULL WHERE state='pending' AND lease_token=?").bind(reason,now,lease).run()
 }
}
