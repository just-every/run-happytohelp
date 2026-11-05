import {legacyBlobContext} from './blob-context'
import {Buffer} from 'node:buffer'
import {archiveOnly} from '../archive-only'
import {preflightLegacy} from './preflight'
import type {D1Database} from '../../import-kit/src/d1/types'
import type {Json,MappingResult,ParsedRecord,TargetEffect} from '../../import-kit/src/types'
import {canonicalJson,sha256} from '../../import-kit/src/provenance/identity'
import {DoorError} from '../../import-kit/src/door/protocol'
import {mapLegacy,tableOrder} from '../mapping'
import {stable,type LegacyBundle,type Row,type MappedRow} from '../types'
import {completeRow,tableName} from './schema'
import {LEGACY_TARGET,targetId,type LegacyValue} from './targets'
import {LEGACY_LIMITS} from './limits'
import {invalid,type DecodedLegacy} from './format'

export interface PreparedLegacy {records:ParsedRecord[];mapping:Map<string,MappingResult>;nativeRows:number;blobChunks:number}
export const recordKey=(kind:string,id:string)=>canonicalJson([kind,id])
const sourceId=(row:Row)=>String(row.id??row.event_id??sha256(stable(row)))
const role=(row:Row)=>{const name=String(row.role??'').toLowerCase();if(!name&&!row.is_owner&&!row.is_admin)invalid('Legacy membership requires an explicit source role.');if(name&&!['owner','admin','operator','agent'].includes(name))invalid('Legacy membership role has no approved native meaning.');if(row.is_owner&&name&&name!=='owner'||row.is_admin&&name&&name!=='admin')invalid('Legacy membership role flags conflict.');return name==='owner'||row.is_owner?'owner':name==='admin'||row.is_admin?'admin':'operator'}

/** Pure mapping remains the only semantic mapper. This bridge binds its scope,
 * completes native values and accounts for every explicitly journaled row. */
export async function prepareLegacy(db:D1Database,decoded:DecodedLegacy,destination:string,ownerId:string,maxRecords:number):Promise<PreparedLegacy>{
 const original=decoded.bundle,owner=await db.prepare('SELECT id,email FROM users WHERE id=?').bind(ownerId).first<{id:string;email:string}>();if(!owner)throw new DoorError('owner_required',403)
 const remap=new Map<string,string>(),people=original.tables.users??[],members=original.tables.project_users??original.tables.memberships??[]
 for(const member of members){if(!member.user_id||archiveOnly('project_users',member,original))continue;const user=people.find(user=>String(user.id)===String(member.user_id));if(!user)invalid('Legacy membership lacks its source identity.');const mappedRole=role(member),sameEmail=String(user.email??'').trim().toLowerCase()===owner.email.toLowerCase();if(mappedRole==='owner'&&!sameEmail||sameEmail&&mappedRole!=='owner')throw new DoorError('legacy_identity_role_conflict',409);if(sameEmail)remap.set(String(user.id),ownerId)}
 for(let start=0;start<people.length;start+=1000){const conflict=await db.prepare(`SELECT 1 FROM json_each(?) source JOIN users native ON lower(native.email)=lower(json_extract(source.value,'$.email')) WHERE native.id<>? AND native.id<>json_extract(source.value,'$.id') LIMIT 1`).bind(canonicalJson(people.slice(start,start+1000).filter(row=>row.email)),ownerId).first();if(conflict)throw new DoorError('legacy_identity_role_conflict',409)}
 const projectDigest=sha256(canonicalJson([destination,String(decoded.manifest.source.projectId)])),priorProject=await db.prepare("SELECT 1 FROM legacy_door_targets WHERE project_id=? AND json_extract(source_json,'$.project')<>? LIMIT 1").bind(destination,projectDigest).first();if(priorProject)throw new DoorError('legacy_source_lineage_conflict',409)
 const tables:LegacyBundle['tables']=Object.create(null),sourceProject=String(decoded.manifest.source.projectId)
 const userFields=new Set(['user_id','agent_id','actor_id','uploaded_by','created_by','created_by_id','operator_id','assigned_to','created_by_user_id'])
 for(const [table,rows] of Object.entries(original.tables))tables[table]=rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,key==='project_id'||table==='projects'&&key==='id'?destination:userFields.has(key)&&remap.has(String(value))?remap.get(String(value)):table==='users'&&key==='id'&&remap.has(String(value))?remap.get(String(value)):value])))
 const objectById=new Map(decoded.objects.map(object=>[String(object.metadata.mediaId),object]))
 for(const row of tables.media??[]){const object=objectById.get(String(row.id));if(!object)invalid('Legacy media has no object.');row.object_key=object.metadata.key}
 const context:LegacyBundle={...original,tables},mapping=new Map<string,MappingResult>(),records:ParsedRecord[]=[],seen=new Set<string>(),nativeIds=new Set<string>();let nativeRows=0,blobChunks=0,eagerBytes=0
 async function effect(mapped:MappedRow,source:{table:string;id:string}):Promise<TargetEffect>{
  const table=tableName(mapped.table),complete=await completeRow(db,table,mapped.row),id=targetId(table,complete.row)
  if(nativeIds.has(id))invalid('Legacy source rows propose the same native identity.');nativeIds.add(id)
  if(++nativeRows>maxRecords)throw new DoorError('legacy_native_expansion_exceeds_grant',413,{reason:'The complete native row and byte-chunk expansion exceeds the unchanged record grant.'})
  const {omitted,...shape}=complete;if(omitted.length)throw new DoorError('legacy_native_schema_unsupported',422,{reason:'A pure legacy projection requires fields absent from this native schema.'})
  const value:LegacyValue={table,...shape,source:{...source,project:sha256(canonicalJson([destination,sourceProject]))}}
  const size=Buffer.byteLength(canonicalJson(value));if(size>512*1024)throw new DoorError('legacy_native_row_exceeds_limit',413);eagerBytes+=size
  return {targetKind:LEGACY_TARGET,targetId:id,value:value as unknown as Json}
 }
 const ordered=Object.entries(tables).sort(([a],[b])=>{const rank=(name:string)=>{const index=tableOrder.indexOf(name);return index<0?1000:index};return rank(a)-rank(b)||a.localeCompare(b)})
 for(const [table,rows] of ordered)for(const [index,row] of rows.entries()){
  const raw=original.tables[table][index],id=sourceId(raw),key=recordKey(table,id),source={table,id},unmapped:{reason:string}[]=[],effects:TargetEffect[]=[]
  if(seen.has(key))invalid('Duplicate legacy primary source identity.');seen.add(key)
  let mapped:MappedRow[];try{mapped=mapLegacy(table,row,context)}catch{invalid('Legacy mapping refused the complete source snapshot.')}
  for(const item of mapped){
   if(['projects','project_settings','email_settings','public_project_aliases'].includes(item.table)){unmapped.push({reason:'Source workspace configuration retained in custody; the claimed destination and its owner configuration are preserved.'});continue}
   if(item.table==='users'&&item.row.id===ownerId||item.table==='memberships'&&item.row.user_id===ownerId){unmapped.push({reason:'Source owner is bound to the current claimed native owner; existing owner rows are retained.'});continue}
   if(item.table==='memberships')item.row.role=role(raw)
   if(item.table==='local_devices')item.row.token_hash=[...sha256(canonicalJson([destination,item.row.id,'revoked-device'])).slice(0,32)].map(hex=>{const n=parseInt(hex,16);return 'x*#_'[n>>2]+'x*#_'[n&3]}).join('')
   if(item.table==='conversations'){const resolved=item.row.resolved_at!==null;Object.assign(item.row,{brand_id:destination,requester_id:item.row.contact_id,submitter_id:item.row.contact_id,status_id:resolved?'solved':Number(item.row.revision)>0?'open':'new',status_category:resolved?'solved':Number(item.row.revision)>0?'open':'new'} )}
   if(item.table==='media'){const object=objectById.get(String(item.row.id));if(!object)invalid('Mapped media lacks byte custody.');item.row.object_key=`legacy-door/${destination}/${encodeURIComponent(String(item.row.id))}/${object.metadata.sha256}`}
   if(item.table==='knowledge_categories')for(const field of ['audience','allowed_domains','requires_entitlement'])if(raw[field]!==undefined)item.row[field]=raw[field]
   if(item.table==='knowledge_articles'){item.row.source_incarnation=sha256(canonicalJson([destination,sourceProject,item.row.id])).slice(0,32);item.row.source_revision=parseInt(sha256(canonicalJson([item.row,(tables.categories??tables.knowledge_categories??[]),(tables.article_categories??tables.knowledge_article_categories??[]).filter(link=>String(link.article_id)===String(item.row.id))])).slice(0,12),16)}
   if(item.table==='contacts'&&!(tables.context_subjects??[]).some(subject=>subject.subject_id===item.row.id))effects.push(await effect({table:'context_subjects',key:['project_id','subject_id'],row:{project_id:destination,subject_id:item.row.id}},source))
   effects.push(await effect(item,source))
   if(item.table==='conversations')effects.push(await effect({table:'reporting_legacy_conversations',key:['project_id','conversation_id'],row:{project_id:destination,conversation_id:item.row.id,run_id:'legacy-door:'+sourceProject}},source))
   if(item.table==='macros'){
    const version=1+parseInt(sha256(canonicalJson(item.row)).slice(0,12),16)
    effects.push(await effect({table:'macro_versions',key:['macro_id','version'],row:{macro_id:item.row.id,project_id:destination,version,title:item.row.title,content:item.row.content,created_by:item.row.created_by,created_at:item.row.updated_at}},source))
    effects.push(await effect({table:'macro_heads',key:['macro_id'],row:{macro_id:item.row.id,version}},source))
   }
   if(item.table==='knowledge_articles'&&item.row.status==='published')effects.push(await effect({table:'knowledge_article_publications',key:['project_id','article_id','source_version'],row:{project_id:destination,article_id:item.row.id,source_version:item.row.source_incarnation+':'+item.row.source_revision,snapshot_json:stable({title:item.row.title,slug:item.row.slug,content:item.row.content,summary:item.row.summary}),created_at:item.row.updated_at}},source))
   if(item.hold){unmapped.push({reason:item.hold});effects.push(await effect({table:'legacy_door_holds',key:['project_id','source_table','source_id','reason'],row:{project_id:destination,source_table:table,source_id:id,reason:item.hold}},source))}
  }
  if(!mapped.length)unmapped.push({reason:'Legacy row retained archive-only by the existing mapper; no native-success credit.'})
  const result={effects,unmapped};mapping.set(key,result)
  records.push({kind:table,sourceId:id,payload:{row:raw,projection:sha256(canonicalJson(result))} as Json,pointer:'/primary/'+table+'/'+index})
 }
 const blobContexts=legacyBlobContext(decoded,destination)
 for(const [objectIndex,{metadata,bytes}] of decoded.objects.entries()){const aliases=blobContexts[objectIndex].aliases;const effects:TargetEffect[]=[],total=Math.max(1,Math.ceil(bytes.length/LEGACY_LIMITS.blobChunkBytes));if(total>1000)throw new DoorError('legacy_object_expansion_exceeds_limit',413)
  for(let ordinal=0;ordinal<total;ordinal++){const chunk=bytes.subarray(ordinal*LEGACY_LIMITS.blobChunkBytes,(ordinal+1)*LEGACY_LIMITS.blobChunkBytes);effects.push(await effect({table:'legacy_door_blob_chunks',key:['project_id','media_id','ordinal'],row:{project_id:destination,media_id:String(metadata.mediaId),object_key:metadata.key,file_name:metadata.file,sha256:metadata.sha256,ordinal,total_chunks:total,total_bytes:bytes.length,chunk_sha256:sha256(chunk),identity_json:canonicalJson(aliases),base64:Buffer.from(chunk).toString('base64')}},{table:'legacy-object',id:String(metadata.mediaId)}));blobChunks++}
  const key=recordKey('legacy-object',String(metadata.mediaId)),result={effects};mapping.set(key,result);records.push({kind:'legacy-object',sourceId:String(metadata.mediaId),payload:{...metadata,projection:sha256(canonicalJson(effects))} as unknown as Json})
 }
 const manifestId=sourceProject;mapping.set(recordKey('legacy-manifest',manifestId),{effects:[],unmapped:[{reason:'Complete source manifest and provenance retained; no business effect.'}]});records.push({kind:'legacy-manifest',sourceId:manifestId,payload:decoded.manifest as unknown as Json})
 if(records.length>maxRecords)throw new DoorError('plan_exceeds_grant_quota',413)
 await preflightLegacy(db,destination,[...mapping.values()].flatMap(result=>result.effects),maxRecords)
 const sourceBytes=records.reduce((n,record)=>n+Buffer.byteLength(canonicalJson(record))+1000,0);if(sourceBytes*2+eagerBytes>LEGACY_LIMITS.eagerBytes)throw new DoorError('legacy_eager_snapshot_exceeds_limit',413,{reason:'The complete source and native projection exceed the eager runtime allowance.'})
 return {records,mapping,nativeRows,blobChunks}
}
