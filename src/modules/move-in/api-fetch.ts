import type {Env} from '../../platform/env'
import {LIMITS,type Run,recordKey} from './types'
import {apiRun,connection,readCredential} from './api-store'
import {vendorHttp,VendorError} from './api-http'
import {readVendorPage,type ApiAttachment,type ApiRecord} from './readers/api'
import {sourceRecord,nativeId} from './readers/common'
import {identityStatements,sourceDigest,identityDigest,erasedUpload,type IdentityLink} from './identities'
import {sha256,canonicalJson} from '../import-kit/src/d1/index'
import {updateRun,objectKey} from './run-store'
import {putPrivate} from './private-custody'
import {guarded} from './context'
export function apiRecordId(record:ApiRecord){if(record.kind==='thread-page'){const url=new URL(record.payload._links.self.href);return `${url.pathname.split('/')[3]}:${record.payload.page.number}`}return String(record.payload.id)}
/** Download locators can contain short-lived credentials. They never enter source custody or an export. */
function withoutLocators(value:any):any {if(Array.isArray(value))return value.map(withoutLocators);if(!value||typeof value!=='object')return value;const result:any={};for(const [key,child] of Object.entries(value)){if(['content_url','attachment_url','download_url'].includes(key))continue;if(key==='url'&&typeof child==='string'&&/[?&](?:token|key|signature|X-Amz-|X-Goog-)/i.test(child))continue;result[key]=withoutLocators(child)}return result}
function identities(run:Run,records:ApiRecord[]){
 const links=new Map<string,IdentityLink>(),add=(source:string,digest=source)=>links.set(source+digest,{source,digest})
 // Conservatively index every scalar, including opaque company attributes and source headers.
 const visit=(value:any)=>{if(typeof value==='string'||typeof value==='number'){const text=String(value),source=sourceDigest(run.project_id,run.vendor,text);add(source);add(source,identityDigest(run.project_id,'email',text.trim().toLowerCase()));add(source,identityDigest(run.project_id,'external',text));return}if(Array.isArray(value)){for(const item of value)visit(item)}else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){visit(key);visit(item)}}
 for(const record of records){visit(record.payload);const source=sourceDigest(run.project_id,run.vendor,apiRecordId(record));add(source);add(source,identityDigest(run.project_id,'external',`import:${run.vendor}:${apiRecordId(record)}`));const p=record.payload;for(const email of [p.email,...(p._embedded?.emails??[]).map((v:any)=>v.value)].filter((v:any)=>typeof v==='string'))add(source,identityDigest(run.project_id,'email',email.trim().toLowerCase()))}
 if(links.size>LIMITS.identityLinks)throw new Error('API page contains too many identity values. No checkpoint advanced.');return [...links.values()]
}
function requester(vendor:string,p:any){return vendor==='helpscout'?p.primaryCustomer?.id:vendor==='intercom'?p.contacts?.contacts?.[0]?.id:p.requester_id}
async function retainAttachment(env:Env,run:Run,file:ApiAttachment,records:ApiRecord[],client:ReturnType<typeof vendorHttp>){
 const ticket=records.find(r=>['ticket','conversation'].includes(r.kind)&&String(r.payload.id)===file.ticketId),person=ticket&&requester(run.vendor,ticket.payload),contactId=person==null?null:nativeId(run.project_id,run.vendor,'contact',String(person)),mediaId=nativeId(run.project_id,run.vendor,'media',`${file.ticketId}:${file.partId}:${file.id}`),conversationId=nativeId(run.project_id,run.vendor,'conversation',file.ticketId),key=`${run.project_id}/${conversationId}/${mediaId}`
 const existing=await env.DB.prepare('SELECT object_key,size FROM media WHERE id=? AND project_id=?').bind(mediaId,run.project_id).first<{object_key:string;size:number}>()
 const insert=(size:number|null,objectKey:string|null,error:string|null)=>env.DB.prepare('INSERT OR REPLACE INTO move_in_api_files(run_id,ticket_id,contact_id,part_id,source_id,filename,content_type,size,private,object_key,error) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(run.id,file.ticketId,contactId,file.partId,file.id,file.filename.slice(0,500),file.contentType,size,file.private?1:0,objectKey,error)
 if(existing){await guarded(env,run,[insert(existing.size,existing.object_key,null)]);return}
 const staged=await env.DB.prepare('SELECT object_key,error FROM move_in_api_files WHERE run_id=? AND ticket_id=? AND part_id=? AND source_id=?').bind(run.id,file.ticketId,file.partId,file.id).first<{object_key:string|null;error:string|null}>();if(staged?.object_key&&await env.FILES.head(staged.object_key))return
 await guarded(env,run,[insert(file.size,key,'Download interrupted; resume import to fetch this file.')])
 try{const {bytes}=await client.attachment(file.url);if(!bytes.length)throw new Error('The provider returned an empty attachment.');if(file.size!==null&&bytes.length!==file.size)throw new Error('The attachment size differs from the provider record.');await putPrivate(env,run,key,bytes,{httpMetadata:{contentType:file.contentType}});await guarded(env,run,[insert(bytes.length,key,null)])}
 catch(error){if(error instanceof VendorError&&[401,403,429].includes(error.status))throw error;await guarded(env,run,[insert(file.size,null,error instanceof VendorError?error.message:error instanceof Error&&error.message==='The attachment size differs from the provider record.'?error.message:'Attachment could not be fetched. Check the file in the source system.')])}
}
export async function fetchApiPage(env:Env,run:Run){
 const api=await apiRun(env,run.id);if(!api)throw new Error('API import connection missing');const conn=await connection(env,api.connection_id);if(!conn)throw new Error('API import connection missing');if(conn.retry_at&&conn.retry_at>Date.now())throw new VendorError(`Provider rate limit: resume after ${new Date(conn.retry_at).toISOString()}.`,429,conn.retry_at)
 const client=vendorHttp(env,run.vendor,conn.base_url,await readCredential(env,conn));let page
 try{page=await readVendorPage(run.vendor,client,api.cursor_json?JSON.parse(api.cursor_json):null,api.since)}catch(error){if(error instanceof VendorError&&error.retryAt)await guarded(env,run,[env.DB.prepare('UPDATE move_in_connections SET retry_at=? WHERE id=?').bind(error.retryAt,conn.id)]);throw error}
 const records=page.records.map(r=>({...r,payload:withoutLocators(r.payload)})),links=identities(run,records)
 if(await erasedUpload(env,run.project_id,links))throw new Error('This source page contains erased contact identities. It cannot be imported again.')
 // Install identity fences before either source bytes or attachment bytes exist.
 await guarded(env,run,identityStatements(env,run.project_id,run.id,links))
 for(const file of page.attachments)await retainAttachment(env,run,file,page.records,client)
 const name=`api-${run.cursor}.json`,body=canonicalJson(records),bytes=new TextEncoder().encode(body);if(bytes.length>LIMITS.inputBytes)throw new Error('This API page exceeds the 2 MiB source-page limit. No checkpoint advanced.')
 if(run.parsed_total+records.length>LIMITS.records)throw new Error('This import exceeds 5,000 source records. No records were published.')
 const key=objectKey(run,`api/${run.cursor}`),hash=sha256(bytes),files=JSON.parse(run.files_json),counts=JSON.parse(api.counts_json),statements:D1PreparedStatement[]=[]
 for(const [index,record] of records.entries()){const value=sourceRecord(run.vendor,record.kind,apiRecordId(record),record.payload,name,hash,index+1,`/${index}/payload`);statements.push(env.DB.prepare('INSERT INTO move_in_records(run_id,ordinal,record_json,serialized) VALUES(?,?,?,?)').bind(run.id,run.parsed_total+index,JSON.stringify(value),canonicalJson(record.payload)));const category=record.kind==='ticket'||record.kind==='conversation'?'tickets':['user','contact'].includes(record.kind)?'contacts':record.kind==='company'?'companies':record.kind==='article'?'articles':null;if(category&&!(record.kind==='user'&&record.payload.role!=='end-user'))counts[category]=(counts[category]??0)+1}
 for(const person of page.agents){const matched=person.email?await env.DB.prepare('SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.project_id=? AND lower(u.email)=lower(?)').bind(run.project_id,person.email).first<{id:string}>():null;statements.push(env.DB.prepare('INSERT OR IGNORE INTO move_in_api_agents(run_id,source_id,name,email,deleted,member_id) VALUES(?,?,?,?,?,?)').bind(run.id,person.id,person.name,person.email,person.deleted?1:0,matched?.id??null));counts.agents=(counts.agents??0)+1}
 counts.attachments=(counts.attachments??0)+page.attachments.length
 await putPrivate(env,run,key,bytes,{httpMetadata:{contentType:'application/json'}});files.push({name,key,sha256:hash,size:bytes.length})
 statements.push(env.DB.prepare('UPDATE move_in_api_runs SET cursor_json=?,counts_json=? WHERE run_id=?').bind(page.next?JSON.stringify(page.next):null,JSON.stringify(counts),run.id),env.DB.prepare('UPDATE move_in_connections SET retry_at=NULL WHERE id=?').bind(conn.id))
 await updateRun(env,run,{state:page.next?'fetching':'planning',cursor:run.cursor+1,parsed_total:run.parsed_total+records.length,files_json:JSON.stringify(files),identity_complete:page.next?0:1},statements)
}
