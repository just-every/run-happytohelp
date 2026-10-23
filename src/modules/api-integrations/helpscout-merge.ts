import {HTTPException} from 'hono/http-exception'
import type {Hono,Context} from 'hono'
import type {AppEnv} from '../../platform/env'
import {auditStatement,requestSource} from '../audit/record'
import {canonicalJson,sha256} from '../import-kit/src/provenance/identity'
import {getRun} from '../move-in/run-store'
import {parseFile,indexFile} from '../move-in/readers/records'
import {prepareHelpScout} from '../move-in/readers/helpscout-mapping'
import {nativeTargets} from '../move-in/targets'
import type {NativeValue} from '../move-in/readers/normalise'
import {helpScoutActor} from './helpscout-authority'
import {getHelpScout} from './helpscout-store'

const refuse=(reason:string):never=>{throw new HTTPException(409,{message:reason})}
const fields=(row:Record<string,unknown>,keys:string[])=>keys.map(key=>row[key]??null)
const messageFields=['id','project_id','conversation_id','local_id','actor_id','actor_role','content','created_at','erased_at','citations_json']

/** A merge is append-only historical intake. It never uses native reply
 * admission and never replaces an operator edit, status, owner or tag. */
async function review(c:Context<AppEnv>){
 const grant=await helpScoutActor(c,'data.import'),{actor}=grant,env=c.env,id=c.req.param('runId')!
 const row=await getHelpScout(env.DB,actor.project_id),run=await getRun(env,id)
 if(!row||row.status!=='connected')refuse('helpscout_connection_required')
 if(!run||run.project_id!==actor.project_id||run.actor_id!==actor.actor_id||run.vendor!=='helpscout')throw new HTTPException(404)
 if(run.state==='erased')throw new HTTPException(410,{message:'helpscout_erased_identity'})
 if(!await env.DB.prepare('SELECT 1 FROM helpscout_sync_receipts WHERE project_id=? AND mailbox_id=? AND run_id=?').bind(actor.project_id,row!.mailbox_id,id).first())throw new HTTPException(404)
 const receipt=await env.DB.prepare('SELECT fingerprint,conversation_id,messages,notes,merged_at FROM helpscout_merge_receipts WHERE project_id=? AND run_id=?').bind(actor.project_id,id).first()
 if(receipt)return {grant,row:row!,run,receipt}
 if(run.state!=='ready'||run.error)refuse('helpscout_review_not_ready')
 const object=await env.FILES.get(run.object_key)
 if(!object||object.size!==run.bytes)refuse('helpscout_source_custody_changed')
 const bytes=new Uint8Array(await object!.arrayBuffer())
 if(sha256(bytes)!==run.artifact_hash)refuse('helpscout_source_custody_changed')
 const file={name:run.filename,bytes},index=indexFile(file,'helpscout')
 if(index.length>100)refuse('helpscout_source_mapping_incomplete')
 const parsed=[...parseFile(file,'helpscout',0,undefined,index)]
 if(parsed.some(item=>item.diagnostic))refuse('helpscout_source_mapping_incomplete')
 const records=parsed.flatMap(item=>item.record?[item.record]:[]),conversations=records.filter(record=>record.kind==='conversation')
 if(conversations.length!==1)refuse('helpscout_one_conversation_required')
 const record=conversations[0]
 if(String((record.payload as any).mailboxId)!==row!.mailbox_id)refuse('helpscout_mailbox_mismatch')
 const mapping=await prepareHelpScout({projectId:actor.project_id,actorId:actor.actor_id,vendor:'helpscout',source:{records,artifacts:[],diagnostics:[]},tagIds:new Map()})
 if(mapping.rejections.size)refuse('helpscout_source_mapping_incomplete')
 const effect=mapping.effects.get('conversation/'+record.sourceId)?.[0]
 if(!effect)refuse('helpscout_source_mapping_incomplete')
 const incoming=effect!.value as unknown as NativeValue,conversation=incoming.tables.conversations[0]
 const before=await nativeTargets.read(env.DB,actor.project_id,'conversation',effect!.targetId)
 if(!before||before.revision==='native')refuse('helpscout_import_ticket_first')
 const native=before!.value as unknown as NativeValue,original=native.tables.move_in_conversations[0],head=native.tables.conversations[0]
 if(!original||original.vendor!=='helpscout'||original.source_id!==record.sourceId||!head||head.contact_id!==conversation.contact_id)refuse('helpscout_identity_mismatch')
 const contact=await env.DB.prepare('SELECT * FROM contacts WHERE project_id=? AND id=?').bind(actor.project_id,head.contact_id).first<any>()
 const mappedContact=[...mapping.effects.values()].flat().find(item=>item.targetKind==='contact'&&item.targetId===head.contact_id)?.value as unknown as NativeValue|undefined
 if(!contact||!mappedContact||contact.external_id!==mappedContact.tables.contacts[0].external_id||contact.email!==mappedContact.tables.contacts[0].email)refuse('helpscout_identity_mismatch')
 const incomingMessages=new Map(incoming.tables.messages.map(message=>[message.id,message])),incomingSources=new Map(incoming.tables.move_in_message_sources.map(source=>[source.message_id,source]))
 const existingMessages=new Map(native.tables.messages.map(message=>[message.id,message]))
 for(const source of native.tables.move_in_message_sources){
  const existing=existingMessages.get(source.message_id),next=incomingMessages.get(source.message_id)
  if(!existing||!next||canonicalJson(fields(existing,messageFields))!==canonicalJson(fields(next,messageFields))||canonicalJson(source)!==canonicalJson(incomingSources.get(source.message_id)))refuse('helpscout_source_history_conflict')
 }
 const incomingNotes=new Map(incoming.tables.move_in_notes.map(note=>[note.id,note]))
 for(const note of native.tables.move_in_notes)if(!incomingNotes.has(note.id)||canonicalJson(note)!==canonicalJson(incomingNotes.get(note.id)))refuse('helpscout_source_history_conflict')
 // IDs already present outside imported provenance are collisions, not deduplication.
 for(const next of incoming.tables.messages)if(existingMessages.has(next.id)&&!native.tables.move_in_message_sources.some(source=>source.message_id===next.id))refuse('helpscout_native_message_collision')
 const messages=incoming.tables.messages.filter(message=>!existingMessages.has(message.id)).sort((a,b)=>a.revision-b.revision).map((message,index):Record<string,any>=>({...message,revision:head.revision+index+1}))
 const notes=incoming.tables.move_in_notes.filter(note=>!native.tables.move_in_notes.some(existing=>existing.id===note.id))
 const sources=incoming.tables.move_in_message_sources.filter(source=>messages.some(message=>message.id===source.message_id))
 const keys=incoming.tables.email_threading_keys.filter(key=>!native.tables.email_threading_keys.some(existing=>existing.key_kind===key.key_kind&&existing.key_value===key.key_value))
 const ticket=await env.DB.prepare('SELECT ticket_version FROM conversations WHERE project_id=? AND id=?').bind(actor.project_id,head.id).first<{ticket_version:number}>()
 const omissions=[...(mapping.omissions.get('conversation/'+record.sourceId)??[]),'native_status_assignment_subject_tags_and_contact_are_preserved']
 const fingerprint=sha256(canonicalJson({run:run.id,artifact:run.artifact_hash,generation:row!.generation,before,contact,ticket,messages,notes,sources,keys,omissions}))
 return {grant,row:row!,run,before,head,contact,ticket,messages,notes,sources,keys,fingerprint,omissions}
}
function receiptView(receipt:any){return {fingerprint:receipt.fingerprint,conversationId:receipt.conversation_id,messages:receipt.messages,notes:receipt.notes,mergedAt:receipt.merged_at}}
export function helpScoutMerges(router:Hono<AppEnv>,root:string){
 router.get(root+'/runs/:runId/merge',async c=>{
  const plan=await review(c)
  if(plan.receipt)return c.json({data:{...receiptView(plan.receipt),merged:true}})
  return c.json({data:{fingerprint:plan.fingerprint,conversationId:plan.head!.id,messages:plan.messages!.map(message=>({id:message.id,role:message.actor_role,content:message.content,createdAt:message.created_at})),notes:plan.notes!.map(note=>({id:note.id,content:note.content,author:JSON.parse(note.author_json),createdAt:note.created_at})),omissions:plan.omissions,merged:false}})
 })
 router.post(root+'/runs/:runId/merge',async c=>{
  const body=await c.req.json().catch(()=>null),plan=await review(c)
  if(plan.receipt){if(body?.fingerprint!==plan.receipt.fingerprint)refuse('helpscout_review_changed');return c.json({data:receiptView(plan.receipt),duplicate:true})}
  if(typeof body?.fingerprint!=='string'||body.fingerprint!==plan.fingerprint)refuse('helpscout_review_changed')
  const {actor,batch}=plan.grant,db=c.env.DB,head=plan.head!,run=plan.run,before=plan.before!,messages=plan.messages!,notes=plan.notes!,now=Date.now()
  const live=()=>db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN
   EXISTS(SELECT 1 FROM helpscout_connections WHERE project_id=? AND generation=? AND status='connected')
   AND EXISTS(SELECT 1 FROM move_in_runs WHERE id=? AND project_id=? AND state='ready' AND artifact_hash=?)
   AND EXISTS(SELECT 1 FROM contacts WHERE project_id=? AND id=? AND email IS ? AND external_id IS ? AND COALESCE(json_extract(metadata_json,'$.is_erasing'),0)!=1 AND COALESCE(json_extract(metadata_json,'$.is_erased'),0)!=1)
   AND NOT EXISTS(SELECT 1 FROM contact_erasures WHERE project_id=? AND contact_id=?)
   THEN 1 ELSE 0 END`).bind(actor.project_id,plan.row.generation,run.id,actor.project_id,run.artifact_hash,actor.project_id,head.contact_id,plan.contact.email,plan.contact.external_id,actor.project_id,head.contact_id)
  const match=nativeTargets.matches(before,actor.project_id,'conversation',head.id)
  const insert=(table:string,rows:Record<string,any>[])=>rows.map(row=>{const columns=Object.keys(row);return db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).bind(...columns.map(column=>row[column]))})
  const statements=[live(),db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN (${match.sql}) THEN 1 ELSE 0 END`).bind(...match.params!),db.prepare('INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM conversations WHERE project_id=? AND id=? AND ticket_version=?) THEN 1 ELSE 0 END').bind(actor.project_id,head.id,plan.ticket!.ticket_version),
   db.prepare('INSERT INTO move_in_native_fences(project_id,conversation_id) VALUES(?,?)').bind(actor.project_id,head.id),
   ...insert('messages',messages),...insert('move_in_message_sources',plan.sources!),...insert('move_in_notes',notes),...insert('email_threading_keys',plan.keys!),
   ...(messages.length?[db.prepare('UPDATE conversations SET revision=?,last_message_id=?,updated_at=MAX(updated_at,?) WHERE project_id=? AND id=?').bind(head.revision+messages.length,messages.at(-1)!.id,now,actor.project_id,head.id)]:[]),
   db.prepare('DELETE FROM move_in_native_fences WHERE project_id=? AND conversation_id=?').bind(actor.project_id,head.id),
   db.prepare('INSERT INTO helpscout_merge_receipts(project_id,run_id,fingerprint,conversation_id,messages,notes,merged_at) VALUES(?,?,?,?,?,?,?)').bind(actor.project_id,run.id,plan.fingerprint!,head.id,messages.length,notes.length,now),
   auditStatement(db,{projectId:actor.project_id,category:'data',action:'helpscout.merged',actor:{type:'user',id:actor.actor_id},source:requestSource(c),target:{type:'conversation',id:head.id},detail:{runId:run.id,messages:messages.length,notes:notes.length}}),live()]
  try{await batch(statements)}catch(error){if(error instanceof HTTPException)throw error;refuse('helpscout_review_changed')}
  return c.json({data:{fingerprint:plan.fingerprint,conversationId:head.id,messages:messages.length,notes:notes.length,mergedAt:now},duplicate:false})
 })
}
