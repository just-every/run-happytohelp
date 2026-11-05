import type {Env} from '../../../platform/env'
import type {SourceBundle,SourceRecord,MappingResult} from '../../import-kit/src/types'
import type {ImportDoorRawSource} from '../../import-kit/src/door/types'
import {sha256} from '../../import-kit/src/provenance/identity'
import {archiveChunk} from '../readers/archive'
import {parseFile,indexFile} from '../readers/records'
import {prepareBundle} from '../preparation'
import {uploadIdentities,erasedUpload} from '../identities'
import {LIMITS,MAPPING_VERSION,recordKey,type PreparedMapping,type Run} from '../types'

/** Whole-bundle mapping is prepared asynchronously once, before Base calls the
 * synchronous mapper. No provider, timer or second HTML converter is involved. */
export function zendeskSource(env:Env,projectId:string,ownerId:string,onPrepared:()=>void=()=>{}){
 let prepared:PreparedMapping|undefined,refusal:string|undefined
 const source:ImportDoorRawSource={format:'raw',mapping:{version:MAPPING_VERSION,map(record){
  if(!prepared)throw new Error('move_in_mapping_not_prepared')
  const key=recordKey(record),rejection=prepared.rejections.get(key)
  const result:MappingResult={effects:rejection?[]:prepared.effects.get(key)??[],unmapped:(prepared.omissions.get(key)??[]).map(reason=>({reason})),...(rejection?{rejection}:{})}
  return result
 }},async readRaw(upload,limits){
  try{
   const indexed=await uploadIdentities(projectId,'zendesk',upload.name,upload.bytes)
   if(await erasedUpload(env,projectId,indexed.links)||!indexed.complete&&await env.DB.prepare('SELECT 1 FROM move_in_erased_identities WHERE project_id=? LIMIT 1').bind(projectId).first())throw new Error('source_erased')
   if(await env.DB.prepare("SELECT 1 FROM move_in_runs WHERE project_id=? AND vendor='zendesk' AND state='erased' AND identity_audited<>1 LIMIT 1").bind(projectId).first())throw new Error('source_erased')
   // This reader runs only after Base consumes the valid grant. Reconcile a
   // bounded contact-key page here, never from the pre-nonce source resolver.
   const stale=(await env.DB.prepare('SELECT k.contact_id,c.email FROM move_in_contact_keys k JOIN contacts c ON c.id=k.contact_id AND c.project_id=k.project_id WHERE k.project_id=? AND k.email_digest IS NULL ORDER BY k.contact_id LIMIT 101').bind(projectId).all<{contact_id:string;email:string}>()).results
   if(stale.length){const {emailKey}=await import('../contact-keys');await env.DB.batch(stale.slice(0,100).map(row=>env.DB.prepare('UPDATE move_in_contact_keys SET email_digest=? WHERE project_id=? AND contact_id=? AND EXISTS(SELECT 1 FROM contacts WHERE id=? AND project_id=? AND email IS ?)').bind(emailKey(projectId,row.email),projectId,row.contact_id,row.contact_id,projectId,row.email)))}
   if(stale.length>100)throw new Error('move_in_contact_index_retry')
   // Only hashes enter this private admission journal. Native erasure follows
   // these aliases even for rejected records or a pre-existing native contact.
   for(let start=0;start<indexed.links.length;start+=500){
    const data=JSON.stringify(indexed.links.slice(start,start+500)),guard=()=>env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM json_each(?2) x JOIN move_in_erased_identities e ON e.project_id=?1 AND e.digest=json_extract(x.value,'$.digest')) THEN 1 ELSE 0 END`).bind(projectId,data)
    try{await env.DB.batch([guard(),env.DB.prepare(`INSERT OR IGNORE INTO h2h_import_door_identities(project_id,bundle_sha256,digest,source_digest) SELECT ?1,?2,json_extract(value,'$.digest'),json_extract(value,'$.source') FROM json_each(?3)`).bind(projectId,upload.sha256,data),guard(),env.DB.prepare('DELETE FROM ik_d1_assertions')])}catch{if(await erasedUpload(env,projectId,indexed.links))throw new Error('source_erased');throw new Error('move_in_identity_index_retry')}
   }
   const bundle:SourceBundle={records:[],artifacts:[],diagnostics:[]};let cursor=0,positions=0,bytes=0
   do{const chunk=await archiveChunk(upload.name,upload.bytes,cursor)
    for(const file of chunk.files){bytes+=file.bytes.length;if(bytes>Math.min(LIMITS.expandedBytes,limits.maxBytes))throw new Error('source_byte_limit')
     const index=indexFile(file,'zendesk',Math.min(LIMITS.records,limits.maxRecords)-positions);positions+=index.length
     if(positions>Math.min(LIMITS.records,limits.maxRecords))throw new Error('source_record_limit')
     for(const item of parseFile(file,'zendesk',0,LIMITS.records,index)){
      if(item.diagnostic&&!item.record)throw new Error(item.diagnostic.code)
      if(item.record)bundle.records.push(item.record)
      if(item.diagnostic)bundle.diagnostics.push(item.diagnostic)
     }
     bundle.artifacts.push({name:file.name,sha256:sha256(file.bytes),size:file.bytes.length,original:{status:'unavailable',reason:'not-supplied'}})
    }
    if(chunk.done)break;cursor=chunk.next
   }while(true)
   // Shared collision and ownership passes use only the server-bound workspace.
   const run={project_id:projectId,actor_id:ownerId,vendor:'zendesk'} as Run
   const result=await prepareBundle(env,run,bundle);prepared=result.prepared;onPrepared()
   if(result.source.records.length>Math.min(LIMITS.records,limits.maxRecords))throw new Error('source_record_limit')
   return result.source.records.map(record=>({kind:record.kind,sourceId:record.sourceId,payload:record.payload,...(record.location.pointer!==undefined?{pointer:record.location.pointer}:{})}))
  }catch(error){refusal=error instanceof Error?error.message:'move_in_source_refused';throw error}
 }}
 return {source,get refusal(){return refusal}}
}
