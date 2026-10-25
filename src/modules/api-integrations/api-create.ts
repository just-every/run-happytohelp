import {senderRule} from '../integrations/suspended-store'
import {reserveCreates,reserveRequester} from './create-quota'
import type {Hono} from 'hono'
import {hashToken} from '../../platform/auth'
import {tokenGuard} from '../../platform/integration-authority'
import {trackingStatement} from '../outcomes/tracking'
import {ApiError} from './errors'
import {type ApiEnv,requireScope,jsonBody} from './http'
import {createInput,canonicalJson} from './create-input'
import {attachments} from './create-attachments'
export function createApi(app:Hono<ApiEnv>){
 app.post('/conversations',requireScope('conversations:create'),async c=>{
  const a=c.get('authority'),p=a.projectId,key=c.req.header('Idempotency-Key')
  if(!key||key.length>200)throw new ApiError(400,'idempotency_key_required')
  if(Number(c.req.header('Content-Length'))>200000)throw new ApiError(413,'payload_too_large')
  if(!c.req.header('Content-Type')?.startsWith('application/json'))throw new ApiError(415,'unsupported_media_type')
  const b=await jsonBody(c)
  if(JSON.stringify(b).length>200000)throw new ApiError(413,'payload_too_large')
  const credential=await c.env.DB.prepare('SELECT * FROM integration_tokens WHERE namespace=? AND id=?').bind(p,a.tokenId).first<any>()
  if(!credential?.source_product)throw new ApiError(403,'outside_credential_bounds')
  const product=credential.source_product,digest=await hashToken(key),bodyDigest=await hashToken(canonicalJson(b)),guard=tokenGuard(a,p,'conversations:create')
  const prior=await c.env.DB.prepare('SELECT * FROM api_requests WHERE project_id=? AND source_product=? AND key_digest=?').bind(p,product,digest).first<any>()
  if(prior){
   if(prior.erased)throw new ApiError(409,'identity_erased')
   if(prior.body_digest!==bodyDigest)throw new ApiError(409,'idempotency_conflict')
   if(!prior.response_json)throw new ApiError(409,'in_progress','Request is in progress',{}, {'Retry-After':'1'})
   c.header('Idempotency-Replayed','true');return c.json(JSON.parse(prior.response_json),prior.status)
  }
  const input=await createInput(c.env,p,credential,b),now=Date.now(),claim=crypto.randomUUID(),id=crypto.randomUUID(),contactId=input.contact?.id??crypto.randomUUID(),messageId=crypto.randomUUID()
  if(input.ref){const existing=await c.env.DB.prepare('SELECT conversation_id FROM api_conversations WHERE project_id=? AND source_product=? AND source_ref=?').bind(p,product,input.ref).first<any>();if(existing)throw new ApiError(409,'source_ref_exists','Append to the existing conversation',{conversation_id:existing.conversation_id})}
  const claimed=await c.env.DB.prepare(`INSERT OR IGNORE INTO api_requests(project_id,source_product,key_digest,body_digest,claim,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(${guard.sql})`).bind(p,product,digest,bodyDigest,claim,now,...guard.params).run()
  if(!claimed.meta.changes)throw new ApiError(409,'in_progress','Request is in progress',{}, {'Retry-After':'1'})
  const privacy=input.contact?{sql:"EXISTS(SELECT 1 FROM contacts WHERE project_id=? AND id=? AND email IS ? AND external_id IS ? AND metadata_json=? AND is_verified=? AND coalesce(json_extract(metadata_json,'$.is_erasing'),0)!=1 AND coalesce(json_extract(metadata_json,'$.is_erased'),0)!=1)",params:[p,input.contact.id,input.contact.email,input.contact.external_id,input.contact.metadata_json,input.contact.is_verified]}:{sql:'1',params:[]}
  const blocked=input.flags.is_blocked||input.email&&(await senderRule(c.env,p,input.email))?.action==='block'
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
   const files=await attachments(c.env,p,credential.family_id,b.attachments)
   for(const file of files){const objectKey=`${p}/${id}/${file.id}`;objects.push(objectKey);await c.env.FILES.put(objectKey,file.bytes,{httpMetadata:{contentType:file.type}})}
   if(heldReason){
    const heldId=crypto.randomUUID(),response={data:{state:'held_for_review',id:heldId,reason:heldReason}}
    const payload=JSON.stringify({api_request:{product,family_id:credential.family_id,credential_id:a.tokenId,name:credential.name,priority:input.priority,mailbox_id:b.mailbox_id??null,group_id:b.group_id??null,ref:input.ref,url:input.url},attachments:files.map(file=>({id:file.id,objectKey:`${p}/${id}/${file.id}`,filename:file.filename,contentType:file.type,size:file.bytes.length}))})
    await c.env.DB.batch([
     c.env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(${guard.sql}) AND (${privacy.sql}) AND NOT EXISTS(SELECT 1 FROM api_erased_keys WHERE project_id=? AND digest IN (SELECT value FROM json_each(?))) AND NOT EXISTS(SELECT 1 FROM move_in_erased_identities WHERE project_id=? AND digest IN (SELECT value FROM json_each(?))) THEN 1 ELSE 0 END`).bind(...guard.params,...privacy.params,p,JSON.stringify(input.digests),p,JSON.stringify(input.digests)),
     ...(!input.contact?[c.env.DB.prepare('INSERT INTO contacts(id,project_id,name,email,external_id,is_verified,metadata_json,created_at) VALUES(?,?,?,?,?,0,?,?)').bind(contactId,p,input.name,input.email,null,JSON.stringify({api_asserted_by:a.tokenId,api_external_id:input.external,...(input.phone?{phone:input.phone}:{})}),now)]:[]),
     ...files.filter(file=>file.uploadId).map(file=>c.env.DB.prepare('UPDATE api_uploads SET contact_id=?,expires_at=0 WHERE id=? AND project_id=?').bind(contactId,file.uploadId!,p)),
    ...input.digests.map(value=>c.env.DB.prepare('INSERT OR IGNORE INTO api_requester_keys VALUES(?,?,?)').bind(p,value,contactId)),
     c.env.DB.prepare('INSERT INTO suspended_emails VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(heldId,p,'api:'+claim,input.email??'', '[]',input.subject,input.content,heldReason,'{}','{}',null,payload,now,now+1209600000),
     c.env.DB.prepare('UPDATE api_requests SET contact_id=?,held_id=?,status=202,response_json=? WHERE project_id=? AND source_product=? AND key_digest=? AND claim=?').bind(contactId,heldId,JSON.stringify(response),p,product,digest,claim),
     c.env.DB.prepare('DELETE FROM ik_d1_assertions')
    ])
    return c.json(response,202)
   }
   const metadata=JSON.stringify({api_asserted_by:a.tokenId,api_source:product,api_external_id:input.external,...(input.phone?{phone:input.phone}:{})}),response={data:{id,subject:input.subject,channel:input.channel,status_category:'new',source_ref:input.ref?{product,ref:input.ref,url:input.url}:null}},history=JSON.stringify({action:'created',credential_name:credential.name,source_product:product,source_ref:input.ref,request_id:claim,idempotency_digest:digest})
   const assert=c.env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(${guard.sql}) AND (${privacy.sql}) AND NOT EXISTS(SELECT 1 FROM api_erased_keys WHERE project_id=? AND digest IN (SELECT value FROM json_each(?))) AND NOT EXISTS(SELECT 1 FROM move_in_erased_identities WHERE project_id=? AND digest IN (SELECT value FROM json_each(?))) THEN 1 ELSE 0 END`).bind(...guard.params,...privacy.params,p,JSON.stringify(input.digests),p,JSON.stringify(input.digests))
   await c.env.DB.batch([
    assert,
    ...(!input.contact?[c.env.DB.prepare('INSERT INTO contacts(id,project_id,name,email,external_id,is_verified,metadata_json,created_at) VALUES(?,?,?,?,?,0,?,?)').bind(contactId,p,input.name,input.email,null,metadata,now)]:[]),
    c.env.DB.prepare('INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at,subject,channel,priority,mailbox_id,group_id,submitter_id,submitter_type,ticket_actor_id,ticket_actor_type,ticket_source,revision,last_message_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,\'api\',?,\'api\',\'api\',0,NULL)').bind(id,p,contactId,now,now,input.subject,input.channel,input.priority,b.mailbox_id??null,b.group_id??null,a.tokenId,a.tokenId),
    c.env.DB.prepare('INSERT INTO api_conversations VALUES(?,?,?,?,?,?,?,?)').bind(id,p,a.tokenId,credential.family_id,credential.name,product,input.ref,input.url),
    c.env.DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,?,'contact',?,1,?)").bind(messageId,p,id,'api:'+digest,contactId,input.content,now),
    ...files.filter(file=>file.uploadId).map(file=>c.env.DB.prepare('UPDATE api_uploads SET contact_id=?,expires_at=0 WHERE id=? AND project_id=?').bind(contactId,file.uploadId!,p)),
    ...input.digests.map(value=>c.env.DB.prepare('INSERT OR IGNORE INTO api_requester_keys VALUES(?,?,?)').bind(p,value,contactId)),
    ...input.tags.map(tag=>c.env.DB.prepare('INSERT INTO conversation_tags VALUES(?,?,?)').bind(p,id,tag)),
    ...files.map(file=>c.env.DB.prepare('INSERT INTO media VALUES(?,?,?,?,?,?,?,?,?,?)').bind(file.id,p,id,contactId,`${p}/${id}/${file.id}`,file.filename,file.type,file.bytes.length,messageId,now)),
    trackingStatement(c.env,id,true),
    c.env.DB.prepare('UPDATE conversations SET revision=1,last_message_id=? WHERE id=? AND project_id=?').bind(messageId,id,p),
    c.env.DB.prepare('INSERT INTO conversation_outbox(project_id,conversation_id,message_id,created_at) VALUES(?,?,?,?)').bind(p,id,messageId,now),
    c.env.DB.prepare("INSERT INTO ticket_history VALUES(?,?,?,?,'api','api',?,?)").bind(crypto.randomUUID(),p,id,a.tokenId,now,history),
    c.env.DB.prepare('UPDATE api_requests SET conversation_id=?,contact_id=?,status=201,response_json=? WHERE project_id=? AND source_product=? AND key_digest=? AND claim=?').bind(id,contactId,JSON.stringify(response),p,product,digest,claim),
    c.env.DB.prepare('DELETE FROM ik_d1_assertions')
   ])
   return c.json(response,201)
  }catch(error){
   // A lost batch response is an unknown outcome. Read the durable receipt before
   // compensating bytes; a committed ticket must retain all its attachments.
   const settled=await c.env.DB.prepare('SELECT response_json,status,erased FROM api_requests WHERE project_id=? AND source_product=? AND key_digest=? AND claim=?').bind(p,product,digest,claim).first<any>()
   if(settled?.erased)throw new ApiError(409,'identity_erased')
   if(settled?.response_json)return c.json(JSON.parse(settled.response_json),settled.status)
   if(objects.length)await c.env.FILES.delete(objects)
   await refund?.()
   await requester?.refund()
   await c.env.DB.prepare('DELETE FROM api_requests WHERE project_id=? AND source_product=? AND key_digest=? AND claim=? AND response_json IS NULL').bind(p,product,digest,claim).run()
   if(error instanceof ApiError)throw error
   if(input.ref){const existing=await c.env.DB.prepare('SELECT conversation_id FROM api_conversations WHERE project_id=? AND source_product=? AND source_ref=?').bind(p,product,input.ref).first<any>();if(existing)throw new ApiError(409,'source_ref_exists','Append to the existing conversation',{conversation_id:existing.conversation_id})}
   throw new ApiError(503,'unavailable','Request could not be committed',{}, {'Retry-After':'5'})
  }
 })
}
