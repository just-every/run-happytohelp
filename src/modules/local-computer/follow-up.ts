import {id,now,mode,requireValue,type LocalEnv} from './contracts'

/** Select only a completed proposal belonging to this operator. The selection
 * is repeated inside the child INSERT so asynchronous approval cannot outlive
 * the computer, grant, membership, result or caller's authority. */
export const followUpSourceSql=`SELECT j.* FROM local_jobs j
 JOIN local_devices d ON d.id=j.device_id AND d.user_id=j.operator_id
 JOIN memberships m ON m.project_id=j.project_id AND m.user_id=j.operator_id
 WHERE j.id=? AND j.project_id=? AND j.conversation_id=? AND j.operator_id=?
 AND j.status='completed' AND j.cancel_requested=0 AND d.revoked_at IS NULL
 AND (d.project_id IS NULL OR d.project_id=j.project_id)
 AND (d.grant_id IS NULL OR EXISTS(SELECT 1 FROM local_grants g WHERE g.id=d.grant_id AND g.user_id=j.operator_id
 AND (g.project_id IS NULL OR g.project_id=j.project_id) AND g.revoked_at IS NULL))
 AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=j.project_id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL)`
export async function approveFollowUp(env:LocalEnv,input:{projectId:string;conversationId:string;operatorId:string;jobId:string;proposalId:string;requireExplicitReply?:true;guard?:{sql:string;params:unknown[]}}){
 const args=[input.jobId,input.projectId,input.conversationId,input.operatorId]
 const job=await env.DB.prepare(followUpSourceSql).bind(...args).first<any>()
 requireValue(job,'Result not accessible',404)
 const result=JSON.parse(job.result),proposal=result.verified===true&&result.follow_up_actions?.find((p:any)=>p.id===input.proposalId)
 requireValue(proposal,'Verified proposal not found',409)
 if(input.requireExplicitReply)requireValue(proposal.mode!=='resolve_reply','Mobile work requires a separate explicit customer reply',403)
 const old=await env.DB.prepare("SELECT * FROM local_receipts WHERE job_id=? AND proposal_id=? AND kind='follow_up'").bind(job.id,proposal.id).first<any>()
 if(old)return old
 const attachments:string[]=proposal.attachment_ids??[],child=id(),requestId=job.id+':'+proposal.id
 const sql=followUpSourceSql+' AND j.result=?'+(input.guard?' AND '+input.guard.sql:'')+attachments.map(()=>` AND EXISTS(SELECT 1 FROM local_attachments a WHERE a.id=? AND a.device_id=j.device_id AND
 (a.job_id=j.id OR EXISTS(SELECT 1 FROM local_attachment_grants g WHERE g.attachment_id=a.id AND g.job_id=j.id AND g.device_id=j.device_id)))`).join('')
 const params=[...args,job.result,...(input.guard?.params??[]),...attachments]
 await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO local_jobs(id,project_id,conversation_id,operator_id,device_id,request_id,mode,instructions,session_id,parent_delegation_id,source_proposal_id,created_at)
  SELECT ?,j.project_id,j.conversation_id,j.operator_id,j.device_id,?,?,?,?,j.id,?,? FROM (${sql}) j`).bind(child,requestId,mode(proposal.mode),proposal.instructions,job.session_id,proposal.id,now(),...params),
  env.DB.prepare(`INSERT OR IGNORE INTO local_receipts(job_id,proposal_id,kind,status,child_delegation_id)
  SELECT ?,?,'follow_up','queued',id FROM local_jobs WHERE project_id=? AND request_id=? AND parent_delegation_id=? AND source_proposal_id=?`).bind(job.id,proposal.id,job.project_id,requestId,job.id,proposal.id),
  ...attachments.map(attachment=>env.DB.prepare(`INSERT OR IGNORE INTO local_attachment_grants(attachment_id,job_id,device_id)
   SELECT a.id,child.id,child.device_id FROM local_attachments a JOIN local_jobs child ON child.project_id=? AND child.request_id=?
   WHERE a.id=? AND a.device_id=child.device_id AND (a.job_id=? OR EXISTS(SELECT 1 FROM local_attachment_grants g WHERE g.attachment_id=a.id AND g.job_id=? AND g.device_id=child.device_id))`).bind(job.project_id,requestId,attachment,job.id,job.id)),
 ])
 const receipt=await env.DB.prepare("SELECT * FROM local_receipts WHERE job_id=? AND proposal_id=? AND kind='follow_up'").bind(job.id,proposal.id).first<any>()
 requireValue(receipt,'Proposal or authority changed, or another task is active. Refresh before approving.',409)
 return receipt
}
