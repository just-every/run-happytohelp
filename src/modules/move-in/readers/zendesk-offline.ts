import {canonicalJson} from '../../import-kit/src/provenance/identity'
import {nativeId,object,sourceId,time} from './common'
import {suppliedAttachments} from '../supplied-attachments'

export const OFFLINE_FORMAT='happytohelp-zendesk-offline-v1'
/** Packing data is deliberately separate from Zendesk's original attachment metadata.
 * It is reviewed, hashed and erased with the ticket, never a second import door. */
export function zendeskOffline(p:Record<string,any>,projectId:string,conversationId:string,tables:Record<string,any[]>,omissions:string[]){
 const offline=p._offline
 if(offline!==undefined&&(!object(offline)||offline.format!==OFFLINE_FORMAT))throw new Error('zendesk_offline_format_invalid')
 if(['comments_truncated','comments_incomplete','has_more'].some(key=>Object.hasOwn(p,key)&&typeof p[key]!=='boolean')||offline?.comments_complete!==undefined&&typeof offline.comments_complete!=='boolean')throw new Error('zendesk_comments_incomplete')
 if(p.comments_truncated===true||p.comments_incomplete===true||p.has_more===true||p.next_page!=null||offline?.comments_complete===false)throw new Error('zendesk_comments_incomplete')
 if(p.comment_count!==undefined&&(!Number.isSafeInteger(p.comment_count)||p.comment_count!==p.comments?.length))throw new Error('zendesk_comments_incomplete')
 if(offline?.provenance!==undefined&&(!Array.isArray(offline.provenance)||offline.provenance.some((s:any)=>!object(s)||typeof s.file!=='string'||typeof s.sha256!=='string'||! /^[a-f0-9]{64}$/.test(s.sha256)||!Number.isSafeInteger(s.row)||s.row<1||typeof s.pointer!=='string')))throw new Error('zendesk_offline_format_invalid')
 if(offline?.history!==undefined&&!object(offline.history))throw new Error('zendesk_history_availability_invalid')
 const bindings=offline?.attachments??[]
 if(!Array.isArray(bindings))throw new Error('attachment_binding_invalid')
 tables.media??=[];tables.move_in_attachment_bytes??=[]
 const seen=new Set<string>(),supplied=new Set<string>()
 for(const comment of p.comments??[]){
  if(!Array.isArray(comment.attachments??[]))throw new Error('attachment_invalid')
  for(const a of comment.attachments??[]){
   if(!object(a))throw new Error('attachment_invalid')
   const aid=sourceId(a.id,'zendesk');if(seen.has(aid))throw new Error('attachment_ambiguous_ownership');seen.add(aid)
   const matches=bindings.filter((b:any)=>String(b.attachment_id)===aid)
   if(matches.length>1)throw new Error('attachment_ambiguous_ownership')
   if(!matches.length){omissions.push(`attachments_metadata_retained_bytes_not_imported:${aid}`);continue}
   const b=matches[0]
   if(sourceId(b.comment_id,'zendesk')!==sourceId(comment.id,'zendesk')||typeof b.path!=='string'||!b.path||b.path.startsWith('/')||b.path.includes('\\')||b.path.split('/').some((v:string)=>!v||v==='.'||v==='..')||supplied.has(b.path))throw new Error('attachment_binding_invalid')
   supplied.add(b.path)
   const when=time(comment.created_at,'iso')
   suppliedAttachments({vendor:'zendesk',attachments:[{...a,name:a.file_name,base64:b.base64,sha256:b.sha256}],projectId,conversationId,messageId:nativeId(projectId,'zendesk','message',`${p.id}:${comment.id}`),visible:comment.public,when,tables,omissions})
  }
 }
 if(bindings.length!==supplied.size)throw new Error('attachment_binding_unmatched')
 if(p.attachments?.length)omissions.push('ticket_level_attachments_not_bound_to_comment')
 if(!offline)return undefined
 const metricEvents=offline?.metric_events??[],audits=offline?.audits??[]
 if(!Array.isArray(metricEvents)||!Array.isArray(audits))throw new Error('zendesk_history_invalid')
 const history:any={metrics:offline?.history?.metrics??'missing',audits:offline?.history?.audits??'missing',events:[],provenance:offline?.provenance??[]}
 for(const kind of ['metrics','audits'])if(!['missing','supplied'].includes(history[kind])||history[kind]==='missing'&&(kind==='metrics'?metricEvents:audits).length)throw new Error('zendesk_history_availability_invalid')
 const ids=new Set<string>()
 for(const e of metricEvents){
  if(!object(e)||sourceId(e.ticket_id,'zendesk')!==String(p.id)||typeof e.type!=='string'||typeof e.metric!=='string'||!e.metric.trim())throw new Error('zendesk_metric_event_invalid')
  if(e.status!==undefined&&(!object(e.status)||['calendar','business'].some(key=>e.status[key]!==undefined&&(typeof e.status[key]!=='number'||!Number.isFinite(e.status[key])||e.status[key]<0))))throw new Error('zendesk_metric_event_invalid')
  const id=sourceId(e.id,'zendesk'),instance=sourceId(e.instance_id,'zendesk');time(e.time,'iso')
  if(ids.has(`metric/${id}`))throw new Error('zendesk_history_duplicate_id');ids.add(`metric/${id}`)
  const knownType=['activate','pause','fulfill','apply_sla','breach'].includes(e.type),knownMetric=['reply_time','agent_work_time','requester_wait_time','pausable_update_time','periodic_update_time'].includes(e.metric),understood=knownType&&knownMetric
  if(!knownMetric)omissions.push(`zendesk_history_unsupported_metric:${e.metric}`)
  if(!understood)omissions.push(`zendesk_history_unsupported_type:${e.type}`)
  history.events.push({kind:'metric',id,ticket_id:String(p.id),instance_id:instance,time:e.time,type:e.type,metric:e.metric,understood,...(e.sla!==undefined?{sla:e.sla}:{}),...(e.status!==undefined?{elapsed:e.status}:{}),...(e.deleted!==undefined?{deleted:e.deleted}:{})})
 }
 for(const audit of audits){
  if(!object(audit)||sourceId(audit.ticket_id,'zendesk')!==String(p.id)||!Array.isArray(audit.events))throw new Error('zendesk_audit_invalid')
  const auditId=sourceId(audit.id,'zendesk');time(audit.created_at,'iso')
  for(const e of audit.events){
   if(!object(e)||typeof e.type!=='string')throw new Error('zendesk_audit_invalid')
   const id=sourceId(e.id,'zendesk');if(ids.has(`audit/${id}`))throw new Error('zendesk_history_duplicate_id');ids.add(`audit/${id}`)
   // Applying old text when later privacy/redaction changed is unsafe. The owner
   // must supply the reconciled conversation, rather than replaying an old body.
   if(/redact|privacy/i.test(e.type)||e.field_name==='public')throw new Error('zendesk_audit_privacy_requires_reconciled_export')
   const understood=['Change','Create'].includes(e.type)&&e.field_name==='status'||e.type==='SlaTargetChange'
   if(!understood)omissions.push(`zendesk_history_unsupported_type:${e.type}`)
   history.events.push({kind:'audit',id,audit_id:auditId,ticket_id:String(p.id),time:audit.created_at,type:e.type,understood,...(audit.author_id!==undefined?{author_id:sourceId(audit.author_id,'zendesk')}:{}),...(e.field_name!==undefined?{field:e.field_name}:{}),...(e.previous_value!==undefined?{previous:e.previous_value}:{}),...(e.value!==undefined?{value:e.value}:{}),...(e.sla!==undefined?{sla:e.sla}:{})})
  }
 }
 history.events.sort((a:any,b:any)=>a.time.localeCompare(b.time)||`${a.kind}/${a.id}`.localeCompare(`${b.kind}/${b.id}`))
 if(history.metrics==='missing')omissions.push('zendesk_metric_history_unavailable')
 if(history.audits==='missing')omissions.push('zendesk_audit_history_unavailable')
 // No schema, clocks or policy activation: the existing native target source
 // is guarded and journaled, and source_json is already portable erasure custody.
 return JSON.parse(canonicalJson(history))
}
