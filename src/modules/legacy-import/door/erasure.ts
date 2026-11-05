import type {Env} from '../../../platform/env'
import {keys,quote,type LegacyTable} from './schema'
import {media} from '../../management/contact-erasure/scope'

export async function legacyErasure(env:Pick<Env,'DB'>,projectId:string,contactId:string){
 if(!await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_door_blob_chunks'").first())return {before:[],after:[]}
 const objects=(await env.DB.prepare('SELECT DISTINCT object_id_digest,object_digest FROM legacy_door_object_identities o WHERE project_id=?1 AND EXISTS(SELECT 1 FROM json_each(o.identity_json) a JOIN move_in_erased_identities e ON e.project_id=?1 AND e.digest=a.value)').bind(projectId).all<{object_id_digest:string;object_digest:string}>()).results,digests=[...new Set(objects.flatMap(object=>[object.object_id_digest,object.object_digest]))]
 return {
  before:[env.DB.prepare('INSERT OR IGNORE INTO move_in_erased_identities(project_id,digest) SELECT ?,value FROM json_each(?)').bind(projectId,JSON.stringify(digests)),env.DB.prepare('DELETE FROM legacy_door_object_identities WHERE project_id=?1 AND EXISTS(SELECT 1 FROM json_each(identity_json) a JOIN move_in_erased_identities e ON e.project_id=?1 AND e.digest=a.value)').bind(projectId),env.DB.prepare(`DELETE FROM legacy_door_blob_chunks WHERE project_id=?1 AND (media_id IN (SELECT id FROM media WHERE ${media}) OR EXISTS(SELECT 1 FROM json_each(identity_json) a JOIN move_in_erased_identities e ON e.project_id=?1 AND e.digest=a.value))`).bind(projectId,contactId)],
  after:(Object.keys(keys) as LegacyTable[]).map(table=>env.DB.prepare(`DELETE FROM legacy_door_targets WHERE project_id=? AND table_name=? AND NOT EXISTS(SELECT 1 FROM ${quote(table)} native WHERE ${keys[table].map((key,i)=>`native.${quote(key)} IS json_extract(legacy_door_targets.keys_json,'$[${i}]')`).join(' AND ')})${table==='contacts'?" OR (project_id=? AND table_name='contacts' AND EXISTS(SELECT 1 FROM contacts c WHERE c.project_id=legacy_door_targets.project_id AND c.id=json_extract(legacy_door_targets.keys_json,'$[0]') AND json_extract(c.metadata_json,'$.is_erased')=1))":''}`).bind(projectId,table,...(table==='contacts'?[projectId]:[])))
 }
}
export function legacyRelatedErasure(contactId:string,emails:string[]){
 const values=new Set([contactId,...emails.map(email=>email.toLowerCase())])
 return {source(record:{payload:unknown}){const stack=[record.payload];while(stack.length){const value=stack.pop();if(typeof value==='string'&&values.has(value.toLowerCase())||typeof value==='number'&&values.has(String(value)))return true;if(Array.isArray(value))stack.push(...value);else if(value&&typeof value==='object')for(const [key,child] of Object.entries(value))stack.push(key,child)}return false}}
}
