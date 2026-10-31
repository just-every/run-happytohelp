import {type Integration,id,now,requireValue} from './contracts';

// Approval consumes one immutable proposal. The edition supplies the current
// conversation fence; device/grant authority and receipt admission live here.
export async function approveFollowUp(c:any,integration:Integration,j:any,proposal:any){
 const db=c.env.DB;
 const receipt=()=>db.prepare("SELECT * FROM local_receipts WHERE job_id=? AND proposal_id=? AND kind='follow_up'").bind(j.id,proposal.id).first();
 const old=await receipt();if(old)return old;
 const child=id(),requestId=j.id+':'+proposal.id,guard=integration.followUpGuard();
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO local_jobs(id,project_id,conversation_id,operator_id,device_id,request_id,mode,instructions,session_id,parent_delegation_id,source_proposal_id,created_at)
   SELECT ?,j.project_id,j.conversation_id,j.operator_id,j.device_id,?,?,?,?,j.id,?,?
   FROM local_jobs j JOIN local_devices d ON d.id=j.device_id AND d.user_id=j.operator_id
   WHERE j.id=? AND j.result=? AND j.status='completed' AND j.cancel_requested=0
   AND d.revoked_at IS NULL AND (d.project_id IS NULL OR d.project_id=j.project_id)
   AND (d.grant_id IS NULL OR EXISTS(SELECT 1 FROM local_grants g WHERE g.id=d.grant_id
    AND g.user_id=j.operator_id AND g.revoked_at IS NULL AND (g.project_id IS NULL OR g.project_id=j.project_id)))
   AND (${guard})`).bind(child,requestId,proposal.mode,proposal.instructions,j.session_id,proposal.id,now(),j.id,j.result),
  db.prepare(`INSERT OR IGNORE INTO local_receipts(job_id,proposal_id,kind,status,child_delegation_id)
   SELECT parent_delegation_id,source_proposal_id,'follow_up','queued',id FROM local_jobs
   WHERE project_id=? AND request_id=? AND parent_delegation_id=? AND source_proposal_id=?`)
   .bind(j.project_id,requestId,j.id,proposal.id),
  ...(proposal.attachment_ids||[]).map((attachment:string)=>db.prepare(`INSERT OR IGNORE INTO local_attachment_grants(attachment_id,job_id,device_id)
   SELECT a.id,r.child_delegation_id,? FROM local_attachments a JOIN local_receipts r
   ON r.job_id=? AND r.proposal_id=? AND r.kind='follow_up'
   WHERE a.id=? AND a.device_id=? AND (a.job_id=? OR EXISTS(SELECT 1 FROM local_attachment_grants g
    WHERE g.attachment_id=a.id AND g.job_id=? AND g.device_id=?))`)
   .bind(j.device_id,j.id,proposal.id,attachment,j.device_id,j.id,j.id,j.device_id)),
 ]);
 const admitted=await receipt();
 requireValue(admitted,'Proposal authority or conversation changed; investigate again',409);
 return admitted;
}
