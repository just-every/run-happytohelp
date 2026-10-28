import {emailKey} from './contact-keys'
import type {Env} from '../../platform/env'
import {sourceIdentity} from '../import-kit/src/provenance/identity'
import type {SourceRecord} from '../import-kit/src/types'
import {readNativeCandidates} from './targets'
import type {PreparedMapping,Run,SourceClaim} from './types'
/** Each query is driven by this bounded upload. Unrelated workspace content never
 * crosses the planning boundary. JSON arrays keep statement bindings independent of size. */
export async function relevantTags(env:Env,projectId:string,records:SourceRecord[]){
 const names=records.filter(record=>record.kind==='tag-name').map(record=>record.sourceId)
 return (await env.DB.prepare('SELECT id,normalized_name FROM workspace_tags WHERE project_id=? AND normalized_name IN (SELECT value FROM json_each(?))').bind(projectId,JSON.stringify(names)).all<{id:string;normalized_name:string}>()).results
}
export async function planningState(env:Env,run:Run,records:SourceRecord[],prepared:PreparedMapping,tags:{id:string}[]){
 const effects=[...prepared.effects.values()].flat(),candidates=[...effects.map(effect=>({kind:effect.targetKind,id:effect.targetId})),...tags.map(tag=>({kind:'tag',id:tag.id}))]
 const {rows:nativeRows,oversized}=await readNativeCandidates(env.DB,run.project_id,candidates)
 for(const record of records)for(const effect of prepared.effects.get(`${record.kind}/${record.sourceId}`)??[])if(oversized.has(`${effect.targetKind}/${effect.targetId}`))prepared.rejections.set(`${record.kind}/${record.sourceId}`,'native_target_review_size_limit')
 const identities=records.map(record=>sourceIdentity(run.project_id,run.vendor,record.kind,record.sourceId))
 // Start with the requested identities even when a job index is available;
 // unrelated sources in the same workspace must not enter this bounded read.
 const claims=(await env.DB.prepare('SELECT s.identity,s.source_hash,s.mapping_version,s.effects_hash,s.job_id FROM json_each(?3) wanted CROSS JOIN ik_sources s ON s.identity=wanted.value CROSS JOIN ik_jobs j ON j.id=s.job_id WHERE j.destination=?1 AND j.namespace=?2').bind(run.project_id,run.vendor,JSON.stringify(identities)).all<SourceClaim>()).results
 const nativeIds=new Map<string,Set<string>>()
 for(const [kind,table] of [['company','companies'],['field','ticket_fields'],['form','request_forms'],['group','ticket_groups'],['calendar','workflow_calendars'],['sla_policy','sla_policies'],['view','ticket_views'],['rule','workflow_rules'],['contact','contacts'],['conversation','conversations'],['macro','macros'],['article','knowledge_articles'],['category','knowledge_categories'],['tag','workspace_tags']]){
  const ids=candidates.filter(candidate=>candidate.kind===kind).map(candidate=>candidate.id)
  if(!ids.length){nativeIds.set(kind,new Set());continue}
  nativeIds.set(kind,new Set((await env.DB.prepare(`SELECT n.id FROM json_each(?2) wanted CROSS JOIN ${table} n ON n.id=wanted.value AND n.project_id=?1`).bind(run.project_id,JSON.stringify(ids)).all<{id:string}>()).results.map(row=>row.id)))
 }
 const companyDomains=effects.filter(effect=>effect.targetKind==='company').flatMap(effect=>(effect.value as any).tables.company_domains)
 if(companyDomains.length){const conflicts=(await env.DB.prepare("SELECT DISTINCT json_extract(candidate.value,'$.company_id') id FROM json_each(?2) candidate JOIN company_domains native ON native.project_id=?1 AND native.domain=json_extract(candidate.value,'$.domain') AND native.company_id<>json_extract(candidate.value,'$.company_id')").bind(run.project_id,JSON.stringify(companyDomains)).all<{id:string}>()).results;for(const record of records)if((prepared.effects.get(`${record.kind}/${record.sourceId}`)??[]).some(effect=>effect.targetKind==='company'&&conflicts.some(row=>row.id===effect.targetId)))prepared.rejections.set(`${record.kind}/${record.sourceId}`,'company_domain_conflict')}
 // EXISTS returns one bit per candidate, even if old native data contains many
 // duplicate addresses. The persisted index supplies JavaScript Unicode normalization semantics.
 const contacts=effects.filter(effect=>effect.targetKind==='contact').map(effect=>{const contact=(effect.value as any).tables.contacts[0];return {id:effect.targetId,email:emailKey(run.project_id,contact.email),external:contact.external_id}})
 const collisions:{id:string;email:number;external:number}[]=[]
 for(let start=0;start<contacts.length;start+=100)collisions.push(...(await env.DB.prepare(`SELECT json_extract(c.value,'$.id') id,
 EXISTS(SELECT 1 FROM move_in_contact_keys p WHERE p.project_id=?1 AND p.contact_id<>json_extract(c.value,'$.id') AND p.email_digest=json_extract(c.value,'$.email')) email,
 EXISTS(SELECT 1 FROM contacts p WHERE p.project_id=?1 AND p.id<>json_extract(c.value,'$.id') AND p.external_id=json_extract(c.value,'$.external')) external
 FROM json_each(?2) c`).bind(run.project_id,JSON.stringify(contacts.slice(start,start+100))).all<{id:string;email:number;external:number}>()).results)
 return {nativeById:new Map(nativeRows.map(row=>[`${row.targetKind}/${row.targetId}`,row])),sourceClaims:new Map(claims.map(claim=>[claim.identity,claim])),claimById:new Map(claims.map(claim=>[claim.identity,claim.source_hash])),nativeIds,collisions:new Map(collisions.map(row=>[row.id,row]))}
}
