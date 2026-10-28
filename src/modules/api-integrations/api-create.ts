import {admitMessage,atomicMessage} from '../conversations/admission'
import {reachableConversation,reachableReference} from './reach'
import {requesterStatements,ticketStatements,type TicketPlan} from './ticket-plan'
import {consumeUploads,finishUploads} from './upload-lifecycle'
import {assertAdmission} from './requester-admission'
import {reserveCreates,reserveRequester} from './create-quota'
import type {Hono} from 'hono'
import {hashToken} from '../../platform/auth'
import {tokenGuard} from '../../platform/integration-authority'
import {ApiError} from './errors'
import {type ApiEnv,requireScope,jsonBody} from './http'
import {createInput,canonicalJson} from './create-input'
import {attachments} from './create-attachments'
export function createApi(app:Hono<ApiEnv>){
 app.post('/conversations',requireScope('conversations:create'),async c=>{
  const a=c.get('authority'),p=a.projectId,key=c.req.header('Idempotency-Key')
  if(!key||key.length>200)throw new ApiError(400,'idempotency_key_required')
  const b=await jsonBody(c)
  const credential=await c.env.DB.prepare('SELECT * FROM api_credentials WHERE namespace=? AND id=?').bind(p,a.credentialId).first<any>()
  if(!credential?.source_product)throw new ApiError(403,'outside_credential_bounds')
  const product=credential.source_product,digest=await hashToken(key),bodyDigest=await hashToken(canonicalJson(b)),guard=tokenGuard(a,p,'conversations:create')
  const prior=await c.env.DB.prepare('SELECT * FROM api_requests WHERE project_id=? AND source_product=? AND key_digest=?').bind(p,product,digest).first<any>()
  if(prior){
   if(prior.erased)throw new ApiError(409,'identity_erased')
   if(prior.conversation_id&&!await reachableConversation(c.env,p,a.credentialId,prior.conversation_id))throw new ApiError(404,'not_found')
   if(prior.body_digest!==bodyDigest)throw new ApiError(409,'idempotency_conflict')
   if(!prior.response_json)throw new ApiError(409,'in_progress','Request is in progress',{}, {'Retry-After':'1'})
   c.header('Idempotency-Replayed','true');return c.json(JSON.parse(prior.response_json),prior.status)
  }
  const input=await createInput(c.env,p,credential,b),now=Date.now(),claim=crypto.randomUUID(),id=crypto.randomUUID(),contactId=input.contact?.id??crypto.randomUUID(),messageId=crypto.randomUUID()
  if(input.ref){const existing=await c.env.DB.prepare('SELECT conversation_id FROM api_conversations WHERE project_id=? AND source_product=? AND source_ref=?').bind(p,product,input.ref).first<any>();if(existing)throw new ApiError(409,'source_ref_exists','Append to the existing conversation',await reachableReference(c.env,p,a.credentialId,existing.conversation_id))}
  const claimed=await c.env.DB.prepare(`INSERT OR IGNORE INTO api_requests(project_id,source_product,key_digest,body_digest,claim,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(${guard.sql})`).bind(p,product,digest,bodyDigest,claim,now,...guard.params).run()
  if(!claimed.meta.changes)throw new ApiError(409,'in_progress','Request is in progress',{}, {'Retry-After':'1'})
  const privacy=input.contact?{sql:"EXISTS(SELECT 1 FROM contacts WHERE project_id=? AND id=? AND email IS ? AND external_id IS ? AND metadata_json=? AND is_verified=? AND coalesce(json_extract(metadata_json,'$.is_erasing'),0)!=1 AND coalesce(json_extract(metadata_json,'$.is_erased'),0)!=1)",params:[p,input.contact.id,input.contact.email,input.contact.external_id,input.contact.metadata_json,input.contact.is_verified]}:{sql:'1',params:[]}
  const blocked=input.flags.is_blocked
  const policy=await c.env.DB.prepare("SELECT json_extract(settings_json,'$.api_abuse_terms') terms FROM project_settings WHERE project_id=?").bind(p).first<{terms:string|null}>()
  const content=[input.subject,input.content,product,input.ref,input.url].join('\n').toLowerCase()
  const abusive=(JSON.parse(policy?.terms||'[]') as string[]).some(term=>content.includes(term))
  const objects:string[]=[]
  let refund:(()=>Promise<void>)|undefined
  let requester:Awaited<ReturnType<typeof reserveRequester>>|undefined
  try{
   requester=await reserveRequester(c.env,p,input.digests)
   const heldReason=blocked?'blocked_sender':requester.held?'requester_cap':abusive?'content_abuse':null
   refund=await reserveCreates(c.env,p,credential)
   const files=await attachments(c.env,p,credential.id,b.attachments)
   for(const file of files){const objectKey=`${p}/${id}/${file.id}`;objects.push(objectKey);await c.env.FILES.put(objectKey,file.bytes,{httpMetadata:{contentType:file.type}})}
   const plan:TicketPlan={body:b,credentialId:credential.id,contactId,files:files.map(file=>({id:file.id,objectKey:`${p}/${id}/${file.id}`,filename:file.filename,contentType:file.type,size:file.bytes.length,...(file.uploadId?{uploadId:file.uploadId}:{})}))}
   const admission=input.admission.guard(!!heldReason)
   if(heldReason){
    const heldId=crypto.randomUUID(),response={data:{state:'held_for_review',id:heldId,reason:heldReason}}
    const payload=JSON.stringify({api_request:{plan,product,credential_id:credential.id,name:credential.name},attachments:plan.files})
    await c.env.DB.batch([
     c.env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(${guard.sql}) AND (${privacy.sql}) AND (${admission.sql}) THEN 1 ELSE 0 END`).bind(...guard.params,...privacy.params,...admission.params),
     ...requesterStatements(c.env,p,credential,plan,input,now),
     ...consumeUploads(c.env,p,credential.id,files),
    ...input.digests.map(value=>c.env.DB.prepare('INSERT OR IGNORE INTO api_requester_keys VALUES(?,?,?)').bind(p,value,contactId)),
     c.env.DB.prepare('INSERT INTO suspended_emails VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(heldId,p,'api:'+claim,input.email??'', '[]',input.subject,input.content,heldReason,'{}','{}',null,payload,now,now+1209600000),
     c.env.DB.prepare('UPDATE api_requests SET contact_id=?,held_id=?,status=202,response_json=? WHERE project_id=? AND source_product=? AND key_digest=? AND claim=?').bind(contactId,heldId,JSON.stringify(response),p,product,digest,claim),
     c.env.DB.prepare('DELETE FROM ik_d1_assertions')
    ])
    await finishUploads(c.env,p,files)
    return c.json(response,202)
   }
   const response={data:{id,subject:input.subject,channel:input.channel,status_category:'new',source_ref:input.ref?{product,ref:input.ref,url:input.url}:null}},history=JSON.stringify({action:'created',credential_name:credential.name,source_product:product,source_ref:input.ref,request_id:claim,idempotency_digest:digest})
   const assert=c.env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(${guard.sql}) AND (${privacy.sql}) AND (${admission.sql}) THEN 1 ELSE 0 END`).bind(...guard.params,...privacy.params,...admission.params)
   const admitted=await admitMessage(c.env,{[atomicMessage]:true,projectId:p,conversationId:id,newRequesterId:contactId,operatorId:credential.issuer_id||'',messages:[{content:input.content},{content:input.subject}],commit:contents=>[
    assert,
    ...requesterStatements(c.env,p,credential,plan,input,now),
    ...consumeUploads(c.env,p,credential.id,files),
    ...input.digests.map(value=>c.env.DB.prepare('INSERT OR IGNORE INTO api_requester_keys VALUES(?,?,?)').bind(p,value,contactId)),
    ...ticketStatements(c.env,p,credential,plan,{...input,content:contents[0],subject:contents[1]},{id,messageId,now,localId:'api:'+digest,actorId:credential.id,actorType:'api',history:JSON.parse(history)}),
    c.env.DB.prepare('UPDATE api_requests SET conversation_id=?,contact_id=?,status=201,response_json=? WHERE project_id=? AND source_product=? AND key_digest=? AND claim=?').bind(id,contactId,JSON.stringify(response),p,product,digest,claim),
    c.env.DB.prepare('DELETE FROM ik_d1_assertions')
   ]})
   if(!admitted.accepted)throw new ApiError(422,'knowledge_access_denied','Knowledge is unavailable to this requester',{blockedRecipients:[contactId]})
   await finishUploads(c.env,p,files)
   return c.json(response,201)
  }catch(error){
   // A lost batch response is an unknown outcome. Read the durable receipt before
   // compensating bytes; a committed ticket must retain all its attachments.
   const settled=await c.env.DB.prepare('SELECT response_json,status,erased,conversation_id FROM api_requests WHERE project_id=? AND source_product=? AND key_digest=? AND claim=?').bind(p,product,digest,claim).first<any>()
   if(settled?.erased)throw new ApiError(409,'identity_erased')
   if(settled?.conversation_id&&!await reachableConversation(c.env,p,a.credentialId,settled.conversation_id))throw new ApiError(404,'not_found')
   if(settled?.response_json)return c.json(JSON.parse(settled.response_json),settled.status)
   if(objects.length)await c.env.FILES.delete(objects)
   await refund?.()
   await requester?.refund()
   await c.env.DB.prepare('DELETE FROM api_requests WHERE project_id=? AND source_product=? AND key_digest=? AND claim=? AND response_json IS NULL').bind(p,product,digest,claim).run()
   await assertAdmission(c.env,input.admission,true)
   if(error instanceof ApiError)throw error
   if(input.ref){const existing=await c.env.DB.prepare('SELECT conversation_id FROM api_conversations WHERE project_id=? AND source_product=? AND source_ref=?').bind(p,product,input.ref).first<any>();if(existing)throw new ApiError(409,'source_ref_exists','Append to the existing conversation',await reachableReference(c.env,p,a.credentialId,existing.conversation_id))}
   throw new ApiError(503,'unavailable','Request could not be committed',{}, {'Retry-After':'5'})
  }
 })
}
