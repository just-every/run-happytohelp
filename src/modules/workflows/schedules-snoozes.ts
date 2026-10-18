import type {Env} from '../../platform/env'
import type {Spent} from './budget'

export const liveScheduleTicketSql=`NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=ws.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=c.project_id AND e.contact_id=c.contact_id)`
const CHUNK=200
const dueSnoozes=`SELECT id FROM (SELECT ws.id,ws.project_id,ws.due_at,ws.created_at,coalesce(q.turn,0) served,row_number() OVER (PARTITION BY ws.project_id ORDER BY ws.due_at,ws.created_at,ws.id) workspace_turn
 FROM workflow_schedules ws JOIN conversations c ON c.id=ws.conversation_id AND c.project_id=ws.project_id JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id LEFT JOIN workflow_queue_turns q ON q.queue='schedule-snoozes' AND q.project_id=ws.project_id
 WHERE ws.kind='snooze' AND ws.state='pending' AND ((ws.due_at IS NOT NULL AND ws.due_at<=?1) OR EXISTS(SELECT 1 FROM conversations d WHERE d.project_id=ws.project_id AND d.id=ws.dependency_id AND d.status_category IN ('solved','closed'))) AND ${liveScheduleTicketSql}) ORDER BY workspace_turn,served,due_at,created_at,project_id,id LIMIT ${CHUNK}`

/** Claim and wake a whole chunk atomically. Only the rows actually woken are
 * published, once per workspace; project activity refreshes the active inbox. */
export async function wakeDueSnoozes(env:Env,now:number,spent?:Spent){
 let processed=0
 const changed=new Set<string>()
 try{
  while(!spent?.()){
   const rows=(await env.DB.prepare(`UPDATE workflow_schedules SET state='woken',reason=CASE WHEN dependency_id IS NOT NULL THEN 'Dependency completed or wake time reached' ELSE 'Wake time reached' END,updated_at=?1,version=version+1 WHERE state='pending' AND kind='snooze' AND id IN (${dueSnoozes}) RETURNING project_id`).bind(now).all<{project_id:string}>()).results
   if(!rows.length)break
   processed+=rows.length
   const projects=[...new Set(rows.map(row=>row.project_id))]
   projects.forEach(project=>changed.add(project))
   await env.DB.prepare("INSERT INTO workflow_queue_turns(queue,project_id,turn) SELECT 'schedule-snoozes',value,(SELECT coalesce(max(turn),0)+1 FROM workflow_queue_turns WHERE queue='schedule-snoozes') FROM json_each(?) WHERE true ON CONFLICT(queue,project_id) DO UPDATE SET turn=excluded.turn").bind(JSON.stringify(projects)).run()
   if(rows.length<CHUNK)break
  }
 }finally{
  await Promise.all([...changed].map(projectId=>env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(`project:${projectId}`)).fetch('https://conversation.internal/event',{method:'POST',body:JSON.stringify({type:'activity',operatorOnly:true,projectId,kind:'assignment'})})))
 }
 return processed
}
