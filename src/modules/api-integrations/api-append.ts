import {attachments} from './create-attachments'
import {conversationBounds} from './bounds'
import type {Hono} from 'hono'
import {hashToken} from '../../platform/auth'
import {tokenGuard} from '../../platform/integration-authority'
import {admitMessage,reservedLocalId,messageCommit} from '../conversations/admission'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {mergedAlias,writableConversationSql} from '../conversation-actions/merge-read'
import {ApiError} from './errors'
import {type ApiEnv,requireScope,jsonBody,iso} from './http'
import {canonicalJson,text} from './create-input'
export function appendApi(app:Hono<ApiEnv>){
 app.post('/conversations/:id/append',requireScope('messages:append'),async c=>{
  const a=c.get('authority'),p=a.projectId,b=await jsonBody(c),id=c.req.param('id'),localId=text(b.localId,200),content=text(b.content,100000)
  if(!['customer','note'].includes(b.kind)||reservedLocalId(localId)||Object.keys(b).some(k=>!['kind','localId','content','attachments'].includes(k)))throw new ApiError(400,'invalid_request')
  const credential=await c.env.DB.prepare('SELECT * FROM integration_tokens WHERE namespace=? AND id=?').bind(p,a.tokenId).first<any>()
  const current=await c.env.DB.prepare(`SELECT c.*,api.source_ref FROM conversations c JOIN api_conversations api ON api.conversation_id=c.id WHERE c.project_id=? AND c.id=? AND ${conversationBounds()} AND ${contactAvailableSql()}`).bind(p,id,a.tokenId).first<any>()
  if(!current)throw new ApiError(404,'not_found')
  const merged=await mergedAlias(c.env,p,id);if(merged)throw new ApiError(409,'merged_into','Conversation was merged',{conversation_id:merged.target_id})
  const digest=await hashToken(canonicalJson(b)),prior=await c.env.DB.prepare('SELECT * FROM api_appends WHERE project_id=? AND conversation_id=? AND family_id=? AND local_id=?').bind(p,id,credential.family_id,localId).first<any>()
  if(prior){if(prior.body_digest!==digest)throw new ApiError(409,'idempotency_conflict');if(!prior.response_json)throw new ApiError(409,'in_progress','Append is in progress',{}, {'Retry-After':'1'});return c.json({...JSON.parse(prior.response_json),duplicate:true})}
  const files=await attachments(c.env,p,credential.family_id,b.attachments),objects:string[]=[]
  try{
  for(const file of files){const key=`${p}/${id}/${file.id}`;objects.push(key);await c.env.FILES.put(key,file.bytes,{httpMetadata:{contentType:file.type}})}
  const fileStatements=(target:string,record:string,note=false)=>files.flatMap(file=>[
   c.env.DB.prepare(`INSERT INTO media SELECT ?,?, ?,?,?, ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${note?'api_notes':'messages'} WHERE id=?)`).bind(file.id,p,target,note?'api:'+a.tokenId:current.contact_id,`${p}/${id}/${file.id}`,file.filename,file.type,file.bytes.length,note?null:record,Date.now(),record),
   ...(note?[c.env.DB.prepare('INSERT INTO api_note_media SELECT ?,id FROM media WHERE id=?').bind(record,file.id)]:[]),
   ...(file.uploadId?[c.env.DB.prepare('UPDATE api_uploads SET contact_id=?,expires_at=0 WHERE project_id=? AND id=? AND EXISTS(SELECT 1 FROM media WHERE id=?)').bind(current.contact_id,p,file.uploadId,file.id)]:[])
  ])
  const guard=tokenGuard(a,p,'messages:append'),now=Date.now(),noteId=crypto.randomUUID()
  // Bind local IDs to the credential family so rotation preserves append identity.
  const messageLocal='api:'+await hashToken(credential.family_id+':'+localId)
  const receipt=(messageId:string,targetId:string,at:number)=>[
   ...fileStatements(targetId,messageId),
   c.env.DB.prepare('INSERT OR IGNORE INTO api_conversations SELECT ?,project_id,credential_id,family_id,credential_name,source_product,NULL,NULL FROM api_conversations WHERE conversation_id=? AND EXISTS(SELECT 1 FROM messages WHERE id=?)').bind(targetId,id,messageId),
   c.env.DB.prepare("INSERT INTO api_appends SELECT ?,?,?,?,?,json_object('data',json_object('id',m.id,'conversation_id',m.conversation_id),'duplicate',json('false')),? FROM messages m WHERE m.id=?").bind(p,id,credential.family_id,localId,digest,current.contact_id,messageId),
   c.env.DB.prepare("INSERT INTO ticket_history SELECT ?,?,m.conversation_id,?,'api','api',?,? FROM messages m WHERE m.id=?").bind(crypto.randomUUID(),p,a.tokenId,at,JSON.stringify({action:'append',credential_name:credential.name,source_product:credential.source_product,source_ref:current.source_ref,request_id:noteId,idempotency_digest:digest,outcome:'committed'}),messageId)
  ]
  if(b.kind==='customer'){
   const actor={id:current.contact_id,contactId:current.contact_id,projectId:p,role:'contact' as const}
   const result=await admitMessage(c.env,{actor,projectId:p,conversationId:id,localId:messageLocal,content,expectedRevision:current.revision,tokenAuthority:a,requireAvailableRequester:true,[messageCommit]:receipt})
   if(!result.accepted)throw new ApiError(409,'conflict')
  }else{
   await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO api_notes SELECT ?,c.id,?,?,?,? FROM conversations c WHERE c.id=? AND c.project_id=? AND ${contactAvailableSql()} AND ${writableConversationSql()} AND EXISTS(${guard.sql}) AND NOT EXISTS(SELECT 1 FROM api_appends WHERE project_id=? AND conversation_id=? AND family_id=? AND local_id=?)`).bind(noteId,'api:'+a.tokenId,credential.name,content,now,id,p,...guard.params,p,id,credential.family_id,localId),
    ...fileStatements(id,noteId,true),
    c.env.DB.prepare("INSERT INTO ticket_history SELECT ?,?,conversation_id,?,'api','api',?,? FROM api_notes WHERE id=?").bind(crypto.randomUUID(),p,a.tokenId,now,JSON.stringify({action:'note',credential_name:credential.name,source_product:credential.source_product,source_ref:current.source_ref,request_id:noteId,idempotency_digest:digest,outcome:'committed'}),noteId),
    c.env.DB.prepare("INSERT INTO api_appends SELECT ?,?,?,?,?,json_object('data',json_object('id',id,'conversation_id',conversation_id),'duplicate',json('false')),? FROM api_notes WHERE id=?").bind(p,id,credential.family_id,localId,digest,current.contact_id,noteId)
   ])
  }
  const stored=await c.env.DB.prepare(`SELECT response_json FROM api_appends r JOIN conversations c ON c.id=r.conversation_id AND c.project_id=r.project_id WHERE r.project_id=? AND r.conversation_id=? AND r.family_id=? AND r.local_id=? AND r.body_digest=? AND ${contactAvailableSql()} AND EXISTS(${guard.sql})`).bind(p,id,credential.family_id,localId,digest,...guard.params).first<any>()
  if(!stored)throw new ApiError(409,'conflict')
  const response=JSON.parse(stored.response_json)
  return c.json(response)
  }finally{
   // Only remove staged bytes after the database proves they were not committed.
   // A failed read leaves an unknown outcome intact for reconciliation.
   if(objects.length){const retained=await c.env.DB.prepare('SELECT object_key FROM media WHERE object_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(objects)).all<{object_key:string}>();const keys=new Set(retained.results.map(row=>row.object_key));await c.env.FILES.delete(objects.filter(key=>!keys.has(key)))}
  }
 })
}
