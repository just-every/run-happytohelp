import type {Env} from '../../platform/env'
import type {SourceBundle} from '../import-kit/src/types'
import {sha256,canonicalJson} from '../import-kit/src/d1/index'
import type {PreparedMapping,Run} from './types'
import {recordKey} from './types'
import {nativeId,sourceRecord} from './readers/common'
import {completeNativeValue} from './targets'
import {apiRun} from './api-store'
const email=(v:any)=>typeof v==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)?v.toLowerCase():null
/** A CC address is a real source identity, but no proof of mailbox possession.
 * When no directory profile exists, record its first observation as an unverified contact. */
export async function prepareApiCcs(env:Env,run:Run,source:SourceBundle,prepared:PreparedMapping){
 if(!await apiRun(env,run.id))return
 const contacts=new Map<string,string>(),extras:SourceBundle['records']=[]
 for(const effects of prepared.effects.values())for(const effect of effects)if(effect.targetKind==='contact'){const row=(effect.value as any).tables.contacts[0];if(row.email)contacts.set(row.email.toLowerCase(),row.id)}
 for(const record of [...source.records]){
  const effect=prepared.effects.get(recordKey(record))?.find(e=>e.targetKind==='conversation');if(!effect)continue
  const p=record.payload as any,value=effect.value as any,c=value.tables.conversations[0],values=run.vendor==='freshdesk'?[...(p.cc_emails??[]),...(p.conversations??[]).filter((part:any)=>!part.private).flatMap((part:any)=>part.cc_emails??[])]:run.vendor==='helpscout'?[...(p.cc??[]),...source.records.filter(r=>r.kind==='thread-page'&&r.sourceId.startsWith(record.sourceId+':')).flatMap(r=>((r.payload as any)._embedded?.threads??[]).filter((t:any)=>t.type!=='note').flatMap((t:any)=>t.cc??[]))]:run.vendor==='intercom'?[...(p.cc??[]),...(p.cc_emails??[]),...(p.source?.cc??[])]:p.email_ccs??[]
  for(const item of values){const address=email(typeof item==='object'?item.email??item.user_email??item.address:item);if(!address||address===(value.tables.contacts?.[0]?.email??'').toLowerCase())continue
   let id=contacts.get(address)
   if(!id){const native=await env.DB.prepare('SELECT id FROM contacts WHERE project_id=? AND lower(email)=? AND coalesce(json_extract(metadata_json,\'$.is_erased\'),0)<>1 ORDER BY id LIMIT 2').bind(run.project_id,address).all<{id:string}>();if(native.results.length>1)throw new Error('CC address matches several workspace contacts; review those contacts before importing.');id=native.results[0]?.id}
   if(!id){id=nativeId(run.project_id,run.vendor,'cc-contact',address);const payload={email:address,firstObservedAt:c.created_at},extra=sourceRecord(run.vendor,'cc-contact',address,payload,record.location.artifact,record.artifactHash,record.location.row??1,record.location.pointer),sourceValue={vendor:run.vendor,kind:'cc-contact',id:address,first_observed_at:c.created_at,api_import:true};extras.push(extra);prepared.effects.set(recordKey(extra),[{targetKind:'contact',targetId:id,value:completeNativeValue('contact',{source:sourceValue,tables:{contacts:[{id,project_id:run.project_id,name:address,email:address,external_id:`import:${run.vendor}:cc:${address}`,created_at:c.created_at,is_verified:0,metadata_json:JSON.stringify({imported_cc:true,first_observed_at:c.created_at})}],context_subjects:[{project_id:run.project_id,subject_id:id,consent:0,revision:0,help_types:'[]',bot_enabled:0}]}}) as any}])}
   contacts.set(address,id)
   if(id!==c.contact_id){const rows=value.tables.conversation_participants??[];if(!rows.some((r:any)=>r.contact_id===id))rows.push({id:nativeId(run.project_id,run.vendor,'participant',`${record.sourceId}:${id}`),conversation_id:c.id,contact_id:id,created_at:c.created_at,joined_via:'cc_header'});value.tables.conversation_participants=rows}
  }
 }
 source.records.unshift(...extras)
}
