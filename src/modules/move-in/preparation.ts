import {retainNativeConflicts} from './retained-sources'
import type {Env} from '../../platform/env'
import {canonicalJson,sha256,type SourceBundle} from '../import-kit/src/d1/index'
import {sourceIdentity} from '../import-kit/src/provenance/identity'
import {planningState,relevantTags} from './planning-state'
import {prepareMapping,withDerivedRecords} from './readers/normalise'
import {STAFF_REQUESTER} from './readers/staff-requesters'
import {recordKey,type Run} from './types'
import type {Vendor} from './types'
const requesterOf=(vendor:Vendor,p:any)=>String(vendor==='zendesk'||vendor==='freshdesk'?p.requester_id:vendor==='helpscout'?p.primaryCustomer?.id:p.contacts?.contacts?.[0]?.id)
// A record the kit rejected before this fix kept its ID with no effects. Undoing that import releases it.
const rejectedClaim=sha256(canonicalJson([]))
// A Zendesk pull keeps what an earlier import holds: a person, company or ticket that
// changed in Zendesk since is left as imported, and new tickets and replies link to it.
const keepsChanged=(run:Run,kind:string)=>run.source==='zendesk-pull'&&['user','organization','ticket',STAFF_REQUESTER].includes(kind)
// The record that holds a ticket's requester: the person, or for staff their inert contact.
const requesterKeys=(vendor:Vendor,id:string)=>vendor==='zendesk'?[`user/${id}`,`${STAFF_REQUESTER}/${id}`]:[`contact/${id}`]
// A usable address only: a person with none, or a malformed one, shares nobody's address.
const address=(value:unknown)=>typeof value==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)?value:null
export async function prepareBundle(env:Env,run:Run,bundle:SourceBundle,conflicts=new Set<string>()){
 const source:SourceBundle=withDerivedRecords(bundle,run.vendor),existing=await relevantTags(env,run.project_id,source.records),prepared=await prepareMapping({projectId:run.project_id,actorId:run.actor_id,vendor:run.vendor,source,tagIds:new Map(existing.map(t=>[t.normalized_name,t.id]))})
 for(const key of conflicts)prepared.rejections.set(key,'conflicting_duplicate_id')
 if(run.vendor==='zendesk'){
  const owners=new Map<string,string[]>();for(const record of source.records.filter(r=>r.kind==='ticket'))for(const comment of (Array.isArray((record.payload as any).comments)?(record.payload as any).comments:[]))for(const a of (Array.isArray(comment?.attachments)?comment.attachments:[])){const key=String(a?.id);owners.set(key,[...(owners.get(key)??[]),recordKey(record)])}
  for(const record of source.records.filter(r=>r.kind==='ticket'))for(const binding of (Array.isArray((record.payload as any)._offline?.attachments)?(record.payload as any)._offline.attachments:[])){const key=`path:${binding?.path}`;owners.set(key,[...(owners.get(key)??[]),recordKey(record)])}
  for(const records of owners.values())if(records.length>1)for(const key of records)prepared.rejections.set(key,'attachment_ambiguous_ownership')
 }

 // A conversation cannot publish when its required imported contact was rejected.
 const rejectedContacts=new Set(source.records.filter(r=>['user','contact',STAFF_REQUESTER].includes(r.kind)&&prepared.rejections.has(recordKey(r))).map(r=>r.sourceId))
 for(const record of source.records){if(!['ticket','conversation'].includes(record.kind))continue;const p=record.payload as any,contact=requesterOf(run.vendor,p);if(!prepared.rejections.has(recordKey(record))&&rejectedContacts.has(contact))prepared.rejections.set(recordKey(record),'conversation_contact_rejected')}
 const {nativeById,claimById,nativeIds,collisions,sourceClaims}=await planningState(env,run,source.records,prepared,existing),kept=new Set<string>()
 await settleReplies(env,run,source.records,prepared,claimById)
 for(const record of source.records){const key=recordKey(record),claim=claimById.get(sourceIdentity(run.project_id,run.vendor,record.kind,record.sourceId));if(record.kind==='tag-name'&&claim){const tagId=existing.find(t=>t.normalized_name===record.sourceId)?.id,tag=tagId?nativeById.get(`tag/${tagId}`):undefined;if(tag)prepared.effects.set(key,[{targetKind:'tag',targetId:tag.targetId,value:tag.value}])}const emptyClaim=sourceClaims.get(sourceIdentity(run.project_id,run.vendor,record.kind,record.sourceId))?.effects_hash===rejectedClaim,mapped=(prepared.effects.get(key)??[]).length>0
  if(emptyClaim&&record.kind!=='tag-name'&&mapped&&!prepared.rejections.has(key)){prepared.rejections.set(key,'earlier_rejection_holds_source_id');continue}
  // A changed copy of a record that never had native effects (historical staff, unsupported kinds) has nothing to replace.
  if(claim&&prepared.heldBack?.has(key)){prepared.heldBack.delete(key);prepared.rejections.set(key,'source_changed_conflict');continue}
  if(claim&&claim!==record.payloadHash&&keepsChanged(run,record.kind)){prepared.rejections.delete(key);prepared.known.add(key);kept.add(key);prepared.omissions.set(key,[...(prepared.omissions.get(key)??[]),'source_changed_kept_as_imported']);continue}
  if(claim&&claim!==record.payloadHash){if(emptyClaim&&!mapped&&!prepared.rejections.has(key))prepared.known.add(key);else prepared.rejections.set(key,'source_changed_conflict');continue}
  for(const effect of prepared.effects.get(key)??[]){const existing=nativeById.get(`${effect.targetKind}/${effect.targetId}`);if((existing||claim)&&!nativeIds.get(effect.targetKind)?.has(effect.targetId)){prepared.rejections.set(key,'native_target_missing');continue}if(existing&&effect.targetKind==='company'&&(effect.value as any).source.created_at===null){const prior=(existing.value as any).tables.companies[0],company=(effect.value as any).tables.companies[0];company.created_at=prior.created_at;company.updated_at=prior.updated_at}if(existing&&effect.targetKind==='article'){const prior=(existing.value as any).tables.knowledge_articles[0],article=(effect.value as any).tables.knowledge_articles[0];article.source_incarnation=prior.source_incarnation;article.publication_version=`${prior.source_incarnation}:${article.source_revision}`}
   if(!prepared.rejections.has(key)&&nativeIds.get(effect.targetKind)?.has(effect.targetId)&&(!claim||!existing||canonicalJson(existing.value)!==canonicalJson(effect.value)))prepared.rejections.set(key,'native_target_conflict')
  }
 }
 for(const record of source.records){const key=recordKey(record),effects=kept.has(key)?[]:prepared.effects.get(key)??[];for(const effect of effects)if(effect.targetKind==='contact')for(const link of (effect.value as any).tables.contact_companies??[])if(source.records.some(company=>prepared.rejections.has(recordKey(company))&&(prepared.effects.get(recordKey(company))??[]).some(target=>target.targetKind==='company'&&target.targetId===link.company_id)))prepared.rejections.set(key,'contact_company_unavailable')}
 for(const record of source.records)for(const effect of kept.has(recordKey(record))?[]:prepared.effects.get(recordKey(record))??[]){if(effect.targetKind!=='contact')continue;const collision=collisions.get(effect.targetId);if(collision?.email)prepared.rejections.set(recordKey(record),'native_contact_email_conflict');if(collision?.external)prepared.rejections.set(recordKey(record),'native_contact_identity_conflict')}
 const emailOwners=new Map<string,string[]>();for(const record of source.records){if(!['user','contact'].includes(record.kind)||kept.has(recordKey(record)))continue;const p=record.payload as any,addressValue=run.vendor==='helpscout'?(prepared.effects.get(recordKey(record))?.find(e=>e.targetKind==='contact')?.value as any)?.tables.contacts[0]?.email:run.vendor==='zendesk'?address(p.email):p.email;if(typeof addressValue==='string'){const address=addressValue.trim().toLowerCase();emailOwners.set(address,[...(emailOwners.get(address)??[]),recordKey(record)])}}
 for(const owners of emailOwners.values())if(owners.length>1)for(const key of owners)prepared.rejections.set(key,'duplicate_source_email')
 for(const record of source.records){if(!['ticket','conversation'].includes(record.kind))continue;const p=record.payload as any,contact=requesterOf(run.vendor,p);if(!prepared.rejections.has(recordKey(record))&&requesterKeys(run.vendor,contact).some(key=>prepared.rejections.has(key)))prepared.rejections.set(recordKey(record),'conversation_contact_rejected');if(!prepared.rejections.has(recordKey(record))&&run.vendor==='zendesk'&&Array.isArray(p.comments)&&p.comments.some((comment:any)=>prepared.rejections.has(`user/${comment.author_id}`)))prepared.rejections.set(recordKey(record),'comment_author_conflict');if(!prepared.rejections.has(recordKey(record))&&run.vendor==='freshdesk'&&Array.isArray(p.conversations)&&p.conversations.some((part:any)=>prepared.rejections.has(`contact/${part?.user_id}`)))prepared.rejections.set(recordKey(record),'comment_author_conflict');if(!prepared.rejections.has(recordKey(record))&&run.vendor==='intercom'&&[p.source?.author,...(p.conversation_parts?.conversation_parts??[]).map((part:any)=>part.author)].some(author=>author&&['contact','user','lead'].includes(author.type)&&prepared.rejections.has(`contact/${author.id}`)))prepared.rejections.set(recordKey(record),'comment_author_conflict')}
 for(const record of source.records)if(run.vendor==='zendesk'&&record.kind==='ticket_comment'&&!prepared.rejections.has(recordKey(record))&&prepared.rejections.has(`user/${(record.payload as any).author_id}`))prepared.rejections.set(recordKey(record),'comment_author_conflict')
 for(const record of source.records)if(run.vendor==='zendesk'&&record.kind==='sla_policy'&&prepared.rejections.has('schedule/'+(record.payload as any).move_in_schedule_id))prepared.rejections.set(recordKey(record),'sla_policy_calendar_unavailable')
 for(const record of source.records)if(run.vendor==='zendesk'&&record.kind==='ticket_form'){const ids=(record.payload as any).ticket_field_ids;if(Array.isArray(ids)&&ids.some((id:any)=>prepared.rejections.has('ticket_field/'+id)))prepared.rejections.set(recordKey(record),'form_field_unavailable')}
 for(const record of source.records)if(run.vendor==='zendesk'&&record.kind==='ticket'){const values=(prepared.effects.get(recordKey(record))?.[0]?.value as any)?.tables?.ticket_field_values??[];if(values.some((value:any)=>source.records.some(field=>field.kind==='ticket_field'&&(prepared.effects.get(recordKey(field))?.[0]?.targetId===value.field_id)&&prepared.rejections.has(recordKey(field)))))prepared.rejections.set(recordKey(record),'ticket_custom_field_definition_conflict')}
 const usableAncestry=retainNativeConflicts(run,source.records,prepared,sourceClaims,nativeById)
 if(run.vendor==='helpscout'){for(const record of source.records){const p=record.payload as any,dependencies=record.kind==='category'?[`collection/${p.collectionId}`]:record.kind==='article'?[`collection/${p.collectionId}`,...(Array.isArray(p.categories)?p.categories.map((id:any)=>`category/${id}`):[])]:[];if(dependencies.some(key=>prepared.rejections.has(key)&&!usableAncestry.has(key)))prepared.rejections.set(recordKey(record),'article_ancestry_incomplete_or_conflicting')}}
 retainNativeConflicts(run,source.records,prepared,sourceClaims,nativeById)
 return {source,prepared}
}
/** A reply attaches to the conversation an earlier import holds for its ticket, and
 * only once: a comment that ticket already carries (or an earlier reply import
 * holds under another review) is refused by name. */
async function settleReplies(env:Env,run:Run,records:SourceBundle['records'],prepared:Awaited<ReturnType<typeof prepareMapping>>,claims:Map<string,string>){
 const wanted=records.filter(record=>record.kind==='ticket_comment'&&!prepared.rejections.has(recordKey(record))).flatMap(record=>{const effect=prepared.effects.get(recordKey(record))?.[0];return effect?[{key:recordKey(record),id:effect.targetId,conversation:(effect.value as any).source.conversation,claimed:claims.has(sourceIdentity(run.project_id,run.vendor,record.kind,record.sourceId))}]:[]})
 if(!wanted.length)return
 const rows=(await env.DB.prepare("SELECT json_extract(w.value,'$.key') key,EXISTS(SELECT 1 FROM move_in_origins o WHERE o.project_id=?1 AND o.target_kind='conversation' AND o.target_id=json_extract(w.value,'$.conversation')) held,(EXISTS(SELECT 1 FROM messages m WHERE m.project_id=?1 AND m.id=json_extract(w.value,'$.id')) OR EXISTS(SELECT 1 FROM move_in_notes n WHERE n.project_id=?1 AND n.id=json_extract(w.value,'$.id'))) present,json_extract(w.value,'$.claimed') claimed FROM json_each(?2) w").bind(run.project_id,JSON.stringify(wanted)).all<{key:string;held:number;present:number;claimed:number}>()).results
 for(const row of rows){if(!row.held)prepared.rejections.set(row.key,'comment_conversation_unavailable');else if(row.present&&!row.claimed)prepared.rejections.set(row.key,'comment_already_imported')}
}
