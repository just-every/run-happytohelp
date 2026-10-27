import {protectLocalModelResult,discloseLocalModelFields} from '../knowledge/local-model-door';
import {inCron,cronRoom} from '../../platform/cron-budget';
import {type App,type Integration,id,now,present,requireValue,text} from './contracts';
import {ownedJob} from './jobs';
import {admitFailureResult} from './provider-errors';
import {validateResult} from './result-validation';
export {validateResult} from './result-validation';
async function deliver(c:any,integration:Integration,j:any,body:string,attachments:string[],proposal:string,resolve:boolean){
 const db=c.env.DB;let receipt:any=await db.prepare("SELECT * FROM local_receipts WHERE job_id=? AND proposal_id=? AND kind='reply'").bind(j.id,proposal).first();
 if(receipt&&receipt.status!=='sending')return receipt;
 if(!receipt){const revision=await integration.deliveryRevision(c.env,j.project_id,j.conversation_id);await db.prepare("INSERT OR IGNORE INTO local_receipts(job_id,proposal_id,kind,status,expected_revision,expected_last_message_id) VALUES(?,?,'reply','sending',?,?)").bind(j.id,proposal,revision,j.expected_last_message_id).run();receipt=await db.prepare("SELECT * FROM local_receipts WHERE job_id=? AND proposal_id=? AND kind='reply'").bind(j.id,proposal).first();}
 requireValue(Number.isInteger(receipt.expected_revision),'Delivery receipt has no immutable command revision',409);
 try{const sent=await integration.deliver(c.env,{projectId:j.project_id,conversationId:j.conversation_id,operatorId:j.operator_id,requestId:'delegation:'+j.id+':'+proposal,expectedRevision:receipt.expected_revision,expectedLastMessageId:receipt.expected_last_message_id,body,attachmentIds:attachments,resolve,source:{jobId:j.id,proposalId:proposal==='legacy'?null:proposal}});await db.batch([db.prepare("UPDATE local_receipts SET status='sent',message_id=? WHERE job_id=? AND proposal_id=? AND kind='reply'").bind(sent.messageId,j.id,proposal),db.prepare('UPDATE local_jobs SET expected_last_message_id=? WHERE id=?').bind(sent.messageId,j.id)]);}catch(error){await db.prepare("UPDATE local_receipts SET status='needs_review',review_message=? WHERE job_id=? AND proposal_id=? AND kind='reply'").bind(error instanceof Error?error.message:'Delivery uncertain; inspect before retry',j.id,proposal).run();}
 return await db.prepare("SELECT * FROM local_receipts WHERE job_id=? AND proposal_id=? AND kind='reply'").bind(j.id,proposal).first();
}
// A report reopens for operator review only while no replacement delegation holds the conversation (local_one_active_conversation).
const reopenUnlessReplaced="CASE WHEN status='completed' AND NOT EXISTS(SELECT 1 FROM local_jobs o WHERE o.project_id=local_jobs.project_id AND o.conversation_id=local_jobs.conversation_id AND o.id!=local_jobs.id AND o.status IN ('queued','running','needs_input')) THEN 'needs_input' ELSE status END";
export async function resumeResultEffects(c:any,integration:Integration,jobId:string){
 const effect:any=await c.env.DB.prepare("SELECT * FROM local_result_effects WHERE job_id=? AND state='pending'").bind(jobId).first();if(!effect)return;
 const j:any=await c.env.DB.prepare('SELECT * FROM local_jobs WHERE id=?').bind(jobId).first(),result=JSON.parse(effect.payload);
 if(j.mode==='resolve_reply'&&result.verified&&!Object.hasOwn(result,'replies')&&result.reply_draft){const receipt:any=await deliver(c,integration,j,text(result.reply_draft),result.attachment_ids||[],'legacy',true);if(receipt.status!=='sent')await c.env.DB.prepare("UPDATE local_jobs SET status="+reopenUnlessReplaced+",delivery_state='review' WHERE id=?").bind(j.id).run();}
 await integration.recordResult(c.env,j,result);
 await c.env.DB.prepare("UPDATE local_result_effects SET state='completed' WHERE job_id=?").bind(jobId).run();
}
export function registerResults(app:App,integration:Integration){
 app.post('/api/local-agents/jobs/:job/result',async c=>{
 const {d,j}=await ownedJob(c,integration),b=await c.req.json();requireValue(b.run_id===j.run_id,'Wrong run',409);const eventId=text(b.event_id,200);
 const prior=await c.env.DB.prepare("SELECT event_id FROM local_events WHERE job_id=? AND event_id=? AND kind='result'").bind(j.id,eventId).first();
 if(!prior){requireValue(['running','needs_input'].includes(j.status),'Job terminal',409);requireValue(['completed','needs_input','failed','cancelled'].includes(b.status),'Invalid result status');
 // Provider markers keep their strict dedicated admission. Every unmarked
 // submission must validate its original proposals and attachment authority.
 const submittedAttachments=b.result&&Object.hasOwn(b.result,'provider_error')?null:validateResult(b.result);
 b.result=admitFailureResult(b.result,b.status,Boolean(j.cancel_requested));const attachments=submittedAttachments??validateResult(b.result);for(const a of attachments)requireValue(await c.env.DB.prepare('SELECT id FROM local_attachments a WHERE id=? AND device_id=? AND (job_id=? OR EXISTS(SELECT 1 FROM local_attachment_grants g WHERE g.attachment_id=a.id AND g.job_id=? AND g.device_id=?))').bind(a,d.id,j.id,j.id,d.id).first(),'Attachment belongs to another job',403);
 let status=j.cancel_requested?'cancelled':b.status;if(status==='completed'&&['resolve','resolve_reply'].includes(j.mode)&&!b.result.verified)status='needs_input';
 // A cancellation may race this admission before the atomic batch. Build both
 // admitted typed projections before converting their narrative storage.
 const cancelledResult=await protectLocalModelResult(c.env,j,admitFailureResult(b.result,b.status,true));
 b.result=await protectLocalModelResult(c.env,j,b.result);

 await c.env.DB.batch([
 c.env.DB.prepare("INSERT OR IGNORE INTO local_events(job_id,event_id,kind,payload,created_at) SELECT id,?,'result',CASE WHEN cancel_requested=1 THEN ? ELSE ? END,? FROM local_jobs WHERE id=? AND run_id=? AND status IN ('running','needs_input')").bind(eventId,JSON.stringify({status:'cancelled',result:cancelledResult}),JSON.stringify({status,result:b.result}),now(),j.id,b.run_id),
 c.env.DB.prepare("UPDATE local_jobs SET status=CASE WHEN cancel_requested=1 THEN 'cancelled' ELSE ? END,result=CASE WHEN cancel_requested=1 THEN ? ELSE ? END,session_id=COALESCE(?,session_id),completed_at=? WHERE id=? AND status IN ('running','needs_input') AND EXISTS(SELECT 1 FROM local_events WHERE job_id=? AND event_id=? AND kind='result')").bind(status,JSON.stringify(cancelledResult),JSON.stringify(b.result),b.session_id||null,['completed','failed','cancelled'].includes(status)?now():null,j.id,j.id,eventId),
 c.env.DB.prepare("INSERT OR IGNORE INTO local_result_effects(job_id,event_id,payload) SELECT id,?,? FROM local_jobs WHERE id=? AND status='completed' AND EXISTS(SELECT 1 FROM local_events WHERE job_id=? AND event_id=? AND kind='result')").bind(eventId,JSON.stringify(b.result),j.id,j.id,eventId)
 ]);
 requireValue(await c.env.DB.prepare("SELECT event_id FROM local_events WHERE job_id=? AND event_id=? AND kind='result'").bind(j.id,eventId).first(),'Result already committed by another event',409);
 }
 await resumeResultEffects(c,integration,j.id);
 return c.json({data:await discloseLocalModelFields(c.env,j,present(await c.env.DB.prepare('SELECT * FROM local_jobs WHERE id=?').bind(j.id).first()))});
 });
 const base='/api/projects/:project/conversations/:conversation/delegations/:job/result';
 app.post(base+'/draft',async c=>{
 const p=await integration.authorize(c,c.req.param('project')!),b=await c.req.json();
 requireValue(b.proposal_id===null||(typeof b.proposal_id==='string'&&b.proposal_id.length>0&&b.proposal_id.length<=200),'Select a reply proposal');
 requireValue(Number.isSafeInteger(b.expected_revision)&&b.expected_revision>=0,'Expected conversation revision required');
 requireValue(b.expected_last_message_id===null||typeof b.expected_last_message_id==='string','Expected conversation frontier required');
 return c.json({data:await integration.prepareDraft(c.env,{projectId:p.projectId,conversationId:c.req.param('conversation')!,
 operatorId:p.userId,jobId:c.req.param('job')!,proposalId:b.proposal_id,expectedRevision:b.expected_revision,expectedLastMessageId:b.expected_last_message_id})});
 });
 async function selected(c:any){const p=await integration.authorize(c,c.req.param('project'));const j:any=await c.env.DB.prepare('SELECT j.* FROM local_jobs j JOIN local_devices d ON d.id=j.device_id WHERE j.id=? AND j.project_id=? AND j.conversation_id=? AND j.operator_id=? AND d.revoked_at IS NULL').bind(c.req.param('job'),p.projectId,c.req.param('conversation'),p.userId).first();requireValue(j,'Result not accessible',404);requireValue(j.status==='completed','Result is not completed',409);const result=JSON.parse(j.result);requireValue(result.verified,'Result unverified',409);return {j,result};}
 app.post(base+'/replies/:proposal/send',async c=>{const {j,result}=await selected(c);const p=result.replies?.find((x:any)=>x.id===c.req.param('proposal'));requireValue(p,'Proposal not found',404);return c.json({data:await deliver(c,integration,j,p.body,p.attachment_ids||[],p.id,false)});});
 app.post(base+'/follow-up-actions/:proposal',async c=>{const {j,result}=await selected(c);const p=result.follow_up_actions?.find((x:any)=>x.id===c.req.param('proposal'));requireValue(p,'Proposal not found',404);const old=await c.env.DB.prepare("SELECT * FROM local_receipts WHERE job_id=? AND proposal_id=? AND kind='follow_up'").bind(j.id,p.id).first();if(old)return c.json({data:old});const child=id();await c.env.DB.batch([c.env.DB.prepare('INSERT INTO local_jobs(id,project_id,conversation_id,operator_id,device_id,request_id,mode,instructions,session_id,parent_delegation_id,source_proposal_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(child,j.project_id,j.conversation_id,j.operator_id,j.device_id,j.id+':'+p.id,p.mode,p.instructions,j.session_id,j.id,p.id,now()),c.env.DB.prepare("INSERT INTO local_receipts(job_id,proposal_id,kind,status,child_delegation_id) VALUES(?,?,'follow_up','queued',?)").bind(j.id,p.id,child),...(p.attachment_ids||[]).map((attachment:string)=>c.env.DB.prepare('INSERT INTO local_attachment_grants(attachment_id,job_id,device_id) SELECT id,?,? FROM local_attachments a WHERE id=? AND device_id=? AND (job_id=? OR EXISTS(SELECT 1 FROM local_attachment_grants g WHERE g.attachment_id=a.id AND g.job_id=? AND g.device_id=?))').bind(child,j.device_id,attachment,j.device_id,j.id,j.id,j.device_id))]);return c.json({data:{child_delegation_id:child,status:'queued'}});});
 app.post('/api/local-agents/jobs/:job/attachments',async c=>{const {d,j}=await ownedJob(c,integration);const form=await c.req.formData(),file=form.get('file');requireValue(form.get('run_id')===j.run_id&&j.status==='running'&&!j.cancel_requested,'Run no longer active',409);requireValue(file instanceof File&&file.size<=4194304&&['image/png','image/jpeg','image/gif'].includes(file.type),'Expected screenshot PNG/JPEG/GIF <=4 MiB');const bytes=new Uint8Array(await file.arrayBuffer());const valid=file.type==='image/png'?bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10':file.type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:new TextDecoder().decode(bytes.slice(0,6)).match(/^GIF8[79]a$/);requireValue(valid,'Screenshot content does not match image type');const upload=id(),key='delegation/'+j.project_id+'/'+j.id+'/'+upload;await c.env.FILES.put(key,bytes,{httpMetadata:{contentType:file.type}});await c.env.DB.prepare('INSERT INTO local_attachments VALUES(?,?,?,?,?,?,?)').bind(upload,j.id,d.id,key,file.type,file.name,file.size).run();return c.json({data:await discloseLocalModelFields(c.env,j,{id:upload,url:'/api/projects/'+j.project_id+'/local-agent-attachments/'+upload,preview_url:'/api/projects/'+j.project_id+'/local-agent-attachments/'+upload,aggregate_type:'image',filename_original:file.name,size:file.size})});});
 app.get('/api/projects/:project/local-agent-attachments/:attachment',async c=>{const p=await integration.authorize(c,c.req.param('project'));const row:any=await c.env.DB.prepare('SELECT a.* FROM local_attachments a JOIN local_jobs j ON j.id=a.job_id WHERE a.id=? AND j.project_id=?').bind(c.req.param('attachment'),p.projectId).first();requireValue(row,'Attachment not found',404);const object=await c.env.FILES.get(row.storage_key);requireValue(object,'Attachment missing',404);return new Response(object.body,{headers:{'Content-Type':row.mime_type,'Cache-Control':'private, no-store'}});});
}
// Each pending effect is swept on its own so one failing row never aborts the scheduled tick or the rows after it.
export async function recoverLocalResultEffects(env:any,integration:Integration,jobId?:string){const effects=await env.DB.prepare("SELECT e.job_id,j.project_id,j.operator_id,d.revoked_at FROM local_result_effects e JOIN local_jobs j ON j.id=e.job_id JOIN local_devices d ON d.id=j.device_id WHERE e.state='pending' AND (? IS NULL OR e.job_id=?) LIMIT 100").bind(jobId??null,jobId??null).all();for(const effect of effects.results){if(inCron(env)&&!cronRoom(env,180)){await env.JOBS.send({type:"local.effects",id:effect.job_id,projectId:effect.project_id});continue;}try{
 // Authority is gone: the report stays terminal and records why its effects stopped. Reopening it would leave active work that the revoked device or departed operator can never continue, holding the conversation.
 if(effect.revoked_at||!await integration.hasAccess(env.DB,effect.operator_id,effect.project_id)){await env.DB.batch([env.DB.prepare("UPDATE local_result_effects SET state='blocked' WHERE job_id=?").bind(effect.job_id),env.DB.prepare("UPDATE local_jobs SET delivery_state='authorization_lost' WHERE id=?").bind(effect.job_id)]);continue;}
 await resumeResultEffects({env},integration,effect.job_id);}catch(error){console.error('Local result effect recovery failed for job '+effect.job_id,error);}}}
