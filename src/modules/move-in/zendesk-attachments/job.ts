import type {Env} from '../../../platform/env'
import {ZendeskError} from '../zendesk-connection/errors'
import {accessToken} from '../zendesk-connection/oauth'
import {getConnection,markReconnect} from '../zendesk-connection/store'
import {Deferred} from '../zendesk-source/context'
import {HOLD_MS} from '../zendesk-source/pull-store'
import {afterCursor,list,sourceGet,type SourceContext} from '../zendesk-source/requests'
import {downloadAttachment,MAX_BYTES} from './download'
import {storeFile} from './files'
import {heldTicket,nextTicket,pageAttachments,recordMissingTicket,recordPage,recordRefusals,unfetched} from './ledger'
import {claimRun,cursorOf,enqueueRun,getRun,runAllowed,saveRun,stopRun,type AttachmentRun,type Cursor} from './store'
/** One step's bounds: a few Zendesk reads, a few files, about one largest file of
 * bytes, and no new download after two minutes, well inside the step's hold. */
const REQUESTS=10,DOWNLOADS=10,STEP_MS=120000
interface Step {cursor:Cursor;source:SourceContext;subdomain:string;downloads:number;bytes:number;started:number;refusals:{a:string;r:string}[];done:boolean;more:boolean}
/** One bounded step of an attachment run per queue message. It catches its own
 * failures and records a stop: it never throws to the queue, whose retries would
 * replay downloads. */
export async function advanceAttachments(env:Env,id:string,projectId:string){
 try{await advance(env,id,projectId)}catch{console.error('Zendesk attachment step could not record its outcome')}
}
async function advance(env:Env,id:string,projectId:string){
 const found=await getRun(env,id),now=Date.now()
 if(!found||found.project_id!==projectId||found.error||found.state!=='running')return
 if(found.next_at>now){await enqueueRun(env,found,found.next_at-now);return}
 if(found.lease_until&&found.lease_until>now){await enqueueRun(env,found,found.lease_until-now+1000);return}
 const run=await claimRun(env,found,now,HOLD_MS);if(!run)return
 if(!await runAllowed(env,run)){await stopRun(env,run,'import_authority_revoked');return}
 const step:Step={cursor:cursorOf(run),source:{env,pull:{subdomain:run.subdomain,project_id:run.project_id},token:'',requests:0,incremental:[]},subdomain:run.subdomain,downloads:0,bytes:0,started:now,refusals:[],done:false,more:false}
 let nextAt:number|undefined
 try{
  const access=await accessToken(env,run.project_id)
  if(access.connection.subdomain!==run.subdomain)throw new ZendeskError('zendesk_connection_changed')
  step.source.token=access.token
  await work(env,run,step)
  await flush(env,run,step)
 }catch(error){
  if(error instanceof Deferred){nextAt=Date.now()+error.waitMs;await flush(env,run,step).catch(()=>{})}
  else{await flush(env,run,step).catch(()=>{});await stopRun(env,run,await stopCode(env,run,error));return}
 }
 try{await saveRun(env,run,{cursor_json:JSON.stringify(step.cursor),state:step.done?'done':'running',next_at:nextAt??0})}
 catch(error){const current=await getRun(env,run.id);if(current&&current.version!==run.version)return;await stopRun(env,run,await stopCode(env,run,error));return}
 if(nextAt)await enqueueRun(env,run,nextAt-Date.now())
 else if(step.more)await enqueueRun(env,run)
}
async function stopCode(env:Env,run:AttachmentRun,error:unknown){
 if(error instanceof ZendeskError){
  if(error.code==='zendesk_reconnect_required'){const row=await getConnection(env,run.project_id).catch(()=>null);if(row)await markReconnect(env,row).catch(()=>{})}
  return error.status?`${error.code}:${error.status}`:error.code
 }
 const message=error instanceof Error?error.message:''
 return message.includes('IMPORT_ATOMIC_GUARD')?'import_authority_revoked':message.startsWith('D1_')||/SQLITE|database/i.test(message)?'attachments_database_failed':'zendesk_attachments_failed'
}
const flush=async(env:Env,run:AttachmentRun,step:Step)=>{if(step.refusals.length){await recordRefusals(env,run,step.refusals);step.refusals=[]}}
const spent=(step:Step)=>step.downloads>0&&(step.downloads>=DOWNLOADS||step.bytes>=MAX_BYTES||Date.now()-step.started>STEP_MS)
/** Walks the workspace's imported Zendesk tickets in id order, one comment page at a
 * time, with fresh content URLs on every read. The cursor stays on a page until each
 * of its files is stored or refused, so a repeated or resumed step reads that page again. */
async function work(env:Env,run:AttachmentRun,step:Step){
 for(;;){
  if(step.source.requests>=REQUESTS||spent(step)){step.more=true;return}
  const held=step.cursor.ticket?await heldTicket(env,run.project_id,step.cursor.ticket):await nextTicket(env,run.project_id,step.cursor.after)
  if(!held){if(step.cursor.ticket){step.cursor={after:step.cursor.ticket};continue}step.done=true;return}
  step.cursor.ticket=held.ticket
  const page=step.cursor.page
  const data=await sourceGet(step.source,`/api/v2/tickets/${held.ticket}/comments.json?page[size]=100&include_inline_images=true${page?`&page[after]=${encodeURIComponent(page)}`:''}`,{missing:true})
  if(data===null){await recordMissingTicket(env,run,held.ticket,'zendesk_ticket_not_found');step.cursor={after:held.ticket};continue}
  const comments=list(data,'comments'),next=afterCursor(data)
  const found=await pageAttachments(env,run.project_id,held.ticket,held.conversation,comments)
  await recordPage(env,run,held.ticket,held.conversation,found)
  for(const file of await unfetched(env,run,found)){
   if(file.deleted){step.refusals.push({a:file.attachmentId,r:'attachment_deleted'});continue}
   if(file.malware){step.refusals.push({a:file.attachmentId,r:'attachment_malware_detected'});continue}
   if(spent(step)){step.more=true;return}
   step.downloads++
   const result=await downloadAttachment(step.subdomain,file.contentUrl,step.source.token)
   if('refused' in result){step.refusals.push({a:file.attachmentId,r:result.refused});continue}
   step.bytes+=result.bytes.byteLength
   if(await storeFile(env,run,held.conversation,file,result.bytes)==='not_held')step.refusals.push({a:file.attachmentId,r:'attachment_comment_not_held'})
  }
  step.cursor=next?{after:step.cursor.after,ticket:held.ticket,page:next}:{after:held.ticket}
 }
}
