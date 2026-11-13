import type {Env} from '../../../platform/env'
import type {LegacyObject} from '../worker-contract'
import type {DeltaLease} from '../lease'
import {heldByNativeMedia} from '../erased'
import {digest,stable} from '../types'
import {checkpoint,type Run} from './state'
import {refuse} from './errors'
/** A temporary, non-content ownership intent for the copy-before-media-apply gap.
 * Existing native erasure already discovers these media/link coordinates across
 * legacy journals. Original chunk IDs, rows and digests remain untouched. */
export async function reserveCanonical(env:Env,run:Run,object:LegacyObject,lease:DeltaLease){
 if(await heldByNativeMedia(env.DB,[object.mediaId],object.key)||await env.DB.prepare('SELECT 1 FROM legacy_import_files WHERE object_key=? LIMIT 1').bind(object.key).first())refuse('object_conflict')
 const media=await env.DB.prepare("SELECT row_json FROM legacy_import_context WHERE run_id=? AND kind='record' AND source_table='media' AND source_id=?").bind(run.id,String(object.mediaId)).first<{row_json:string}>()
 if(!media)refuse('invalid_scope',422)
 const row=JSON.parse(media.row_json),intent=run.id
 const coordinates:Record<string,unknown>={id:String(object.mediaId),project_id:run.source_project_id}
 for(const key of ['contact_id','conversation_id','message_id','support_delegation_id','original_media_id'])if(row[key]!=null)coordinates[key]=String(row[key])
 const links=await env.DB.prepare("SELECT link_id,row_json FROM legacy_import_context_media WHERE run_id=? AND media_id=? AND link_id NOT IN ('','prior-record') ORDER BY link_id LIMIT 251").bind(run.id,String(object.mediaId)).all<{link_id:string;row_json:string}>()
 if(links.results.length>250)refuse('row_too_large')
 const records=[{table:'media',id:String(object.mediaId),row:coordinates},...links.results.map(link=>{const r=JSON.parse(link.row_json);return {table:'mediables',id:link.link_id,row:{id:link.link_id,project_id:run.source_project_id,media_id:String(object.mediaId),mediable_type:String(r.mediable_type).split('\\').at(-1),mediable_id:String(r.mediable_id)}}})]
 const parents=new Map<string,{table:string;id:string;row:Record<string,unknown>}>()
 const addParent=async(table:string,id:unknown,depth=0):Promise<void>=>{
  if(id==null||depth>3||parents.has(table+':'+id))return
  const saved=await env.DB.prepare("SELECT row_json FROM legacy_import_context WHERE run_id=? AND kind='record' AND source_table=? AND source_id=?").bind(run.id,table,String(id)).first<{row_json:string}>()
  if(!saved)refuse('invalid_scope',422)
  const source=JSON.parse(saved.row_json),coordinates:Record<string,unknown>={id:String(id),project_id:run.source_project_id}
  for(const key of ['contact_id','conversation_id','message_id','support_delegation_id'])if(source[key]!=null)coordinates[key]=String(source[key])
  parents.set(table+':'+id,{table,id:String(id),row:coordinates})
  if(source.conversation_id!=null)await addParent('conversations',source.conversation_id,depth+1)
 }
 for(const key of ['conversation_id','message_id','support_delegation_id'])if(row[key]!=null)await addParent(key==='conversation_id'?'conversations':key==='message_id'?'messages':'support_delegations',row[key])
 for(const link of links.results){const r=JSON.parse(link.row_json),kind=String(r.mediable_type).split('\\').at(-1),table=kind==='Message'?'messages':kind==='Event'?'events':kind==='SupportDelegation'?'support_delegations':null;if(table)await addParent(table,r.mediable_id)}
 records.push(...parents.values())
 const statements=[lease.assertion(env.DB),env.DB.prepare('INSERT OR IGNORE INTO legacy_import_objects(run_id,object_key,sha256,size) VALUES(?,?,?,?)').bind(run.id,object.key,object.sha256,object.size),env.DB.prepare("INSERT OR IGNORE INTO legacy_package_keys(manifest_sha256,key,kind,ordinal,generation) VALUES(?,?,'object',0,1)").bind(run.manifest_sha256,object.key)]
 for(const r of records)statements.push(env.DB.prepare("INSERT OR IGNORE INTO legacy_import_rows(run_id,source_table,source_id,row_digest,source_json,status) VALUES(?,?,?,?,?,'copy_intent')").bind(intent,r.table,r.id,await digest(stable(r.row)),JSON.stringify(r.row)))
 statements.push(lease.cleared(env.DB));await checkpoint(env,run,{},statements)
}
/** Called by the core's existing journalStatements hook in the SAME batch as
 * canonical media + source journal. Cleanup can never delete native-held bytes. */
export interface CanonicalTarget {key:string;kind:string;id:string}
export function releaseCanonical(db:D1Database,run:Run,table:string,ids:string[],targets:CanonicalTarget[]=[]){
 if(run.contract_version!==2||!ids.length)return []
 const encoded=JSON.stringify(ids),intent=run.id
 return [...(targets.length?[db.prepare("DELETE FROM legacy_package_keys WHERE manifest_sha256=?1 AND key IN (SELECT json_extract(value,'$.key') FROM json_each(?3) AS proposed WHERE json_extract(value,'$.kind')='media' AND EXISTS(SELECT 1 FROM media WHERE id=json_extract(proposed.value,'$.id') AND project_id=?2 AND object_key=json_extract(proposed.value,'$.key')) OR json_extract(value,'$.kind')='legacy_import_files' AND EXISTS(SELECT 1 FROM legacy_import_files WHERE project_id=?2 AND media_id=json_extract(proposed.value,'$.id') AND object_key=json_extract(proposed.value,'$.key')))").bind(run.manifest_sha256,run.source_project_id,JSON.stringify(targets))]:[]),db.prepare("DELETE FROM legacy_import_rows WHERE run_id=?1 AND (source_table=?3 AND source_id IN (SELECT value FROM json_each(?2)) OR ?3='media' AND source_table='mediables' AND json_extract(source_json,'$.media_id') IN (SELECT value FROM json_each(?2)))").bind(intent,encoded,table)]
}
/** Late reservations contain only a random nonce. Sweep them after staging's
 * quantum, sharing its 100-key ceiling and cleanup claim; transferred keys are never swept. */
export async function sweepCanonicalNonces(env:Pick<Env,'DB'|'FILES'>,sha:string,room:number){
 if(room<=0)return 0
 if(!await env.DB.prepare("SELECT 1 FROM legacy_package_custody WHERE manifest_sha256=? AND status IN ('invalidated','purging','purged')").bind(sha).first())return 0
 const id=`legacy-package:${sha}`,run=await env.DB.prepare('SELECT cursor_json FROM legacy_import_worker_runs WHERE id=?').bind(id).first<{cursor_json:string}>()
 const after=run?JSON.parse(run.cursor_json).canonicalAfter??'':''
 const page=await env.DB.prepare("SELECT object_key FROM legacy_import_objects WHERE run_id=?1 AND object_key>?2 AND EXISTS(SELECT 1 FROM legacy_package_keys WHERE manifest_sha256=?4 AND key=object_key AND kind='object') ORDER BY object_key LIMIT ?3").bind(id,after,Math.min(100,room),sha).all<{object_key:string}>()
 for(const {object_key:key} of page.results){const object=await env.FILES.head(key);if(object?.customMetadata?.canonicalReservation===id)await env.FILES.delete(key)}
 await env.DB.prepare("UPDATE legacy_import_worker_runs SET cursor_json=? WHERE id=? AND EXISTS(SELECT 1 FROM legacy_package_custody WHERE manifest_sha256=? AND status IN ('invalidated','purging','purged'))").bind(JSON.stringify({canonicalAfter:page.results.length?page.results.at(-1)!.object_key:''}),id,sha).run()
 return page.results.length
}

/** Copy intents contain only opaque ancestry coordinates. Retire leftovers in a
 * bounded page once closure has finished and no interrupted erasure needs them. */
export async function cleanupCopyIntents(env:Pick<Env,'DB'>,sha:string,room:number){
 if(room<=0)return 0
 const c=await env.DB.prepare("SELECT source_project_id FROM legacy_package_custody WHERE manifest_sha256=? AND status='purged'").bind(sha).first<{source_project_id:string}>()
 if(!c||await env.DB.prepare('SELECT 1 FROM contact_erasure_leases WHERE project_id=? LIMIT 1').bind(c.source_project_id).first())return 0
 const intent=`legacy-package:${sha}`,page=await env.DB.prepare('SELECT rowid FROM legacy_import_rows WHERE run_id=? LIMIT ?').bind(intent,Math.min(250,room)).all<{rowid:number}>()
 if(page.results.length)await env.DB.prepare('DELETE FROM legacy_import_rows WHERE run_id=? AND rowid IN (SELECT value FROM json_each(?))').bind(intent,JSON.stringify(page.results.map(r=>r.rowid))).run()
 return page.results.length
}
