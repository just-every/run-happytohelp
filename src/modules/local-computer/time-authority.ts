import {now,requireValue} from './contracts'

export const MAX_TASK_MINUTES=15
export type TimeAuthority={granted_by:string;granted_at:number;expires_at:number;minutes:number}
/** Recorded with creation, never renewed by a claim, heartbeat, input or retry. */
export function timeAuthorityStatement(db:D1Database,jobId:string,operatorId:string,minutes:unknown=MAX_TASK_MINUTES,guard?:{sql:string;params:unknown[]}){
 requireValue(Number.isInteger(minutes)&&Number(minutes)>=1&&Number(minutes)<=MAX_TASK_MINUTES,'Choose a task time limit from 1 to 15 minutes')
 const at=Date.now(),authority:TimeAuthority={granted_by:operatorId,granted_at:at,expires_at:at+Number(minutes)*60000,minutes:Number(minutes)}
 return db.prepare(`INSERT INTO local_events(job_id,event_id,kind,payload,created_at) SELECT ?,'authority','authority',?,? ${guard?'WHERE '+guard.sql:''}`)
  .bind(jobId,JSON.stringify(authority),now(),...(guard?.params??[]))
}
export async function timeAuthority(db:D1Database,jobId:string):Promise<TimeAuthority|null>{
 const row=await db.prepare("SELECT payload FROM local_events WHERE job_id=? AND event_id='authority' AND kind='authority'").bind(jobId).first<{payload:string}>()
 return row?JSON.parse(row.payload):null
}
/** Legacy records remain readable. Every newly admitted job has an atomic grant. */
export const liveTimeAuthority=(alias='j')=>`NOT EXISTS(SELECT 1 FROM local_events deadline WHERE deadline.job_id=${alias}.id AND deadline.event_id='authority' AND deadline.kind='authority' AND (COALESCE(json_type(deadline.payload,'$.expires_at')<>'integer',1) OR json_extract(deadline.payload,'$.expires_at')<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))`
export async function expireTimeAuthority(db:D1Database,job:any){
 const authority=await timeAuthority(db,job.id)
 if(!authority||Number.isSafeInteger(authority.expires_at)&&authority.expires_at>Date.now())return false
 // Withdrawal is not proof that a process stopped. Preserve all recorded evidence.
 await db.prepare("UPDATE local_jobs SET status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'revoked' END,cancel_requested=1,delivery_state='authority_expired',completed_at=? WHERE id=? AND status IN ('queued','running','needs_input')").bind(now(),job.id).run()
 return true
}
export async function requireTimeAuthority(db:D1Database,job:any){requireValue(!await expireTimeAuthority(db,job),'Task time authority expired; review the local outcome before granting a new task',409)}
