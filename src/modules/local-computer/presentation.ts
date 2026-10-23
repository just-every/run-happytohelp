import {timeAuthority} from './time-authority';
import {present} from './contracts';
export async function presentJob(db:D1Database,row:any){
 if(!row)return row;
 const value=present(row);
 const authority=await timeAuthority(db,row.id);value.authority=authority?{...authority,expired:authority.expires_at<=Date.now()}:null;
 const events=await db.prepare('SELECT event_id,kind,payload,created_at FROM local_events WHERE job_id=? ORDER BY created_at').bind(row.id).all();
 value.progress=events.results.filter(e=>e.kind==='progress').map(e=>({id:e.event_id,created_at:e.created_at,...JSON.parse(String(e.payload))}));
 value.input_messages=events.results.filter(e=>e.kind==='input').map(e=>({id:e.event_id,created_at:e.created_at,...JSON.parse(String(e.payload))}));
 value.cancel_requested=!!value.cancel_requested;
 if(value.result){const receipts=await db.prepare('SELECT * FROM local_receipts WHERE job_id=?').bind(row.id).all();
  for(const [field,kind] of [['replies','reply'],['follow_up_actions','follow_up']])for(const proposal of value.result[field]||[]){const receipt=receipts.results.find(r=>r.proposal_id===proposal.id&&r.kind===kind);Object.assign(proposal,receipt||{status:'available'});}
  for(const part of [value.result,...(value.result.replies||[]),...(value.result.follow_up_actions||[])]){part.attachments=[];for(const attachment of part.attachment_ids||[]){const media:any=await db.prepare('SELECT a.* FROM local_attachments a WHERE a.id=? AND a.device_id=? AND (a.job_id=? OR EXISTS(SELECT 1 FROM local_attachment_grants g WHERE g.attachment_id=a.id AND g.job_id=?))').bind(attachment,row.device_id,row.id,row.id).first();if(media)part.attachments.push({id:media.id,url:'/api/projects/'+row.project_id+'/local-agent-attachments/'+media.id,preview_url:'/api/projects/'+row.project_id+'/local-agent-attachments/'+media.id,aggregate_type:'image',filename_original:media.filename,size:media.size});}}
 }
 return value;
}
