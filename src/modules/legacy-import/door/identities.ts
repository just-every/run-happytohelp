import {legacyBlobContext} from './blob-context'
import type {Env} from '../../../platform/env'
import {identityDigest,contactDigests} from '../../move-in/identities'
import {DoorError} from '../../import-kit/src/door/protocol'
import type {DecodedLegacy} from './format'

/** All exact scalar aliases are indexed, even in context, rejected/archive-only
 * rows and object metadata. Only opaque digests cross the custody boundary. */
export async function indexLegacyIdentities(env:Pick<Env,'DB'>,project:string,bundleHash:string,decoded:DecodedLegacy){
 const aliases=new Set<string>(),stack:unknown[]=[decoded.manifest,decoded.bundle.tables]
 const add=(kind:string,value:string)=>{aliases.add(identityDigest(project,kind,value));if(aliases.size>100_000)throw new DoorError('legacy_identity_index_exceeds_limit',413)}
 while(stack.length){const value=stack.pop();if(typeof value==='string'||typeof value==='number'){const text=String(value);if(text){add('legacy-value',text);add('external',text);if(text.trim())add('email',text.trim().toLowerCase())}if(typeof value==='string'&&/^[\[{]/.test(value.trim())){try{const decoded=JSON.parse(value);if(decoded&&typeof decoded==='object')stack.push(decoded)}catch{}}}else if(Array.isArray(value))for(const child of value)stack.push(child);else if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){stack.push(key,child)}}
 const objects=legacyBlobContext(decoded,project);for(const object of objects){aliases.add(object.objectId);aliases.add(object.object)}
 const links=[...aliases]
 for(let start=0;start<links.length;start+=500){const part=JSON.stringify(links.slice(start,start+500)),guard=()=>env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM json_each(?2) a JOIN move_in_erased_identities e ON e.project_id=?1 AND e.digest=a.value) THEN 1 ELSE 0 END`).bind(project,part)
  if(await env.DB.prepare('SELECT 1 FROM json_each(?2) a JOIN move_in_erased_identities e ON e.project_id=?1 AND e.digest=a.value LIMIT 1').bind(project,part).first())throw new DoorError('source_erased',409)
  await env.DB.batch([guard(),env.DB.prepare('INSERT OR IGNORE INTO h2h_import_door_identities(project_id,bundle_sha256,digest,source_digest) SELECT ?1,?2,value,value FROM json_each(?3)').bind(project,bundleHash,part),guard(),env.DB.prepare('DELETE FROM ik_d1_assertions')])
 }
 for(let start=0;start<objects.length;start+=100){const rows=objects.slice(start,start+100).map(object=>({objectId:object.objectId,object:object.object,aliases:JSON.stringify(object.aliases)}));await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO legacy_door_object_identities(project_id,bundle_sha256,object_id_digest,object_digest,identity_json) SELECT ?1,?2,json_extract(value,'$.objectId'),json_extract(value,'$.object'),json_extract(value,'$.aliases') FROM json_each(?3)").bind(project,bundleHash,JSON.stringify(rows))])}
 const people=(decoded.bundle.tables.contacts??[]).map(row=>{let metadata:any={};try{metadata=typeof row.metadata==='string'?JSON.parse(row.metadata):row.metadata??{}}catch{}const source=identityDigest(project,'legacy-value',String(row.id));return {source,digests:[...contactDigests(project,{email:row.provided_email??row.email,external_id:row.identifier??row.external_id,metadata_json:JSON.stringify(metadata)}),...contactDigests(project,{email:row.email,external_id:row.external_id})]}})
 for(let start=0;start<people.length;start+=100){const rows=people.slice(start,start+100).flatMap(person=>person.digests.map(digest=>({source:person.source,digest})));await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO h2h_import_door_identities(project_id,bundle_sha256,digest,source_digest) SELECT ?1,?2,json_extract(value,'$.digest'),json_extract(value,'$.source') FROM json_each(?3)").bind(project,bundleHash,JSON.stringify(rows))])}
}
export function legacyContactAliases(project:string,id:string,contact:{email?:unknown;external_id?:unknown;metadata_json?:string|null}){return [...contactDigests(project,contact),identityDigest(project,'legacy-value',id),identityDigest(project,'external',id),identityDigest(project,'email',id.toLowerCase())]}
