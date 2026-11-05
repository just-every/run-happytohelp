import type {D1Database} from '../../import-kit/src/d1/types'
import {canonicalJson} from '../../import-kit/src/provenance/identity'
import {relationships} from '../relationships'
import type {Row} from '../types'
import {recordKey,type PreparedLegacy} from './bridge'
import type {DecodedLegacy} from './format'
import {keys,quote,type LegacyTable} from './schema'
import {targetId,type LegacyValue} from './targets'
import {unitGroups,unitHash,unitRefusal,type LegacyDependency} from './unit-graph'

type Projection={owner:string;value:LegacyValue}
/** Read installed schema and explicitly retained lineage anchors. This does no
 * mapping and no writes. Its result is an input to the pure compiler. */
export async function legacyUnitDependencies(db:D1Database,prepared:PreparedLegacy,decoded:DecodedLegacy,destination:string,ownerId:string){
 const projections:Projection[]=[],byTable=new Map<string,Projection[]>(),edges:LegacyDependency[]=[],anchors:{from:string;table:string;key:unknown;evidence:string}[]=[]
 const source=new Map(prepared.records.map(record=>[recordKey(record.kind,record.sourceId),record]))
 for(const [owner,mapping] of prepared.mapping)for(const effect of mapping.effects){const value=effect.value as unknown as LegacyValue,p={owner,value},group=byTable.get(value.table)??[];group.push(p);byTable.set(value.table,group);projections.push(p)}
 const anchorCache=new Map<string,Row>(),indexCache=new Map<string,Map<string,Projection>>()
 async function reference(from:string,table:string,columns:string[],values:unknown[],atomic:boolean,reason:string){
  if(values.some(value=>value===null||value===undefined))return
  const signature=canonicalJson([table,columns]);let index=indexCache.get(signature)
  if(!index){index=new Map();for(const p of byTable.get(table)??[]){const key=canonicalJson(columns.map(column=>p.value.row[column]));if(index.has(key))return unitRefusal('A native dependency has ambiguous ownership.');index.set(key,p)}indexCache.set(signature,index)}
  const parent=index.get(canonicalJson(values)),binding={table,columns,values,reason}
  if(parent){edges.push({from,to:parent.owner,atomic,evidence:{...binding,projection:unitHash(parent.value)}});return}
  const key=canonicalJson([table,columns,values]);let row=anchorCache.get(key)
  if(!row){row=await db.prepare(`SELECT * FROM ${quote(table)} WHERE ${columns.map(column=>`${quote(column)} IS ?`).join(' AND ')}`).bind(...values).first<Row>()??undefined;if(!row)return unitRefusal('A native dependency is missing from the complete source and retained destination.')
   if(row.project_id!==undefined&&row.project_id!==destination||table==='projects'&&row.id!==destination)return unitRefusal('A dependency belongs to another destination.')
   const currentIdentity=table==='projects'&&row.id===destination||table==='users'&&row.id===ownerId
   if(!currentIdentity){if(!Object.hasOwn(keys,table))return unitRefusal('A dependency is outside the supported native lineage.');const nativeId=targetId(table as LegacyTable,row),owned=await db.prepare('SELECT 1 FROM legacy_door_targets WHERE project_id=? AND target_id=?').bind(destination,nativeId).first();if(!owned)return unitRefusal('A dependency has no ownership in this legacy lineage.')}
   anchorCache.set(key,row)
  }
  anchors.push({from,table,key:binding,evidence:unitHash(row)})
 }
 for(const [table,items] of byTable){
  const foreign=(await db.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all<{id:number;seq:number;table:string;from:string;to:string|null}>()).results,groups=new Map<number,typeof foreign>()
  for(const fk of foreign){const group=groups.get(fk.id)??[];group.push(fk);groups.set(fk.id,group)}
  for(const group of groups.values()){group.sort((a,b)=>a.seq-b.seq);const parent=group[0].table,shape=(await db.prepare(`PRAGMA table_info(${quote(parent)})`).all<{name:string;pk:number}>()).results,primary=shape.filter(column=>column.pk).sort((a,b)=>a.pk-b.pk),columns=group.map((fk,i)=>fk.to??primary[i]?.name)
   if(columns.some(column=>!column))return unitRefusal('The installed schema has an unsupported parent identity.')
   const atomic=table.startsWith('knowledge_')&&parent.startsWith('knowledge_')||['messages','media','conversation_notes','conversation_participants','conversation_buckets','conversation_ai','reporting_legacy_conversations'].includes(table)&&['conversations','messages'].includes(parent)
   for(const p of items)await reference(p.owner,parent,columns,group.map(fk=>p.value.row[fk.from]),atomic,'foreign-key')
  }
 }
 for(const p of projections){const r=p.value.row,table=p.value.table
  if(table==='conversations'){
   await reference(p.owner,'messages',['id'],[r.last_message_id],true,'transcript-head')
   await reference(p.owner,'users',['id'],[r.assigned_to],false,'assigned-operator')
   for(const field of ['requester_id','submitter_id'])await reference(p.owner,'contacts',['id'],[r[field]],false,field)
  }
  if(table==='messages'){
   const actor=String(r.actor_role),parent=actor==='contact'?'contacts':actor==='operator'?'users':actor==='ai'?'ai_profiles':null
   if(!parent)return unitRefusal('A message actor has no supported dependency meaning.')
   await reference(p.owner,parent,['id'],[r.actor_id],false,'message-actor')
  }
  if(r.subject_id!=null&&table!=='context_subjects')await reference(p.owner,'context_subjects',['project_id','subject_id'],[r.project_id,r.subject_id],false,'context-subject')
  if(table==='context_subjects')await reference(p.owner,'contacts',['id'],[r.subject_id],false,'context-contact')
  if(table==='conversation_ai')await reference(p.owner,'ai_profiles',['id'],[r.ai_id],false,'conversation-assistant')
  if(table==='knowledge_datasets')await reference(p.owner,'knowledge_versions',['id'],[r.published_version],true,'published-version')
  if(table==='media'){
   const candidates=['users','contacts'].filter(table=>(byTable.get(table)??[]).some(p=>p.value.row.id===r.uploaded_by)||table==='users'&&r.uploaded_by===ownerId)
   if(candidates.length!==1)return unitRefusal('Media uploader ownership is absent or ambiguous.')
   await reference(p.owner,candidates[0],['id'],[r.uploaded_by],false,'media-uploader')
  }
 }
 const related=relationships(decoded.bundle)
 const link=(from:string,kind:string,id:unknown,reason:string)=>{const to=recordKey(kind,String(id));if(!source.has(to))return unitRefusal('A source relationship lacks its primary identity.');edges.push({from,to,atomic:true,evidence:{reason,kind,id}})}
 for(const record of prepared.records){
  const from=recordKey(record.kind,record.sourceId)
  if(record.kind==='messages'){const row=(record.payload as {row:Row}).row;link(from,'conversations',row.conversation_id,'complete-transcript')}
  if(record.kind==='legacy-object')link(from,'media',record.sourceId,'path-bound-object')
  if(record.kind==='media'){
   const row=related.find('media',record.sourceId);if(!row)return unitRefusal('A media source lacks its decoded context.')
   if(row.original_media_id!=null)link(from,'media',row.original_media_id,'media-ancestry')
   const pivot=related.mediaMessages.get(record.sourceId),message=row.message_id??pivot?.mediable_id
   if(message!=null)link(from,'messages',message,'media-message')
   if(row.conversation_id!=null)link(from,'conversations',row.conversation_id,'media-conversation')
  }
  if(record.kind==='mediables'){
   const row=(record.payload as {row:Row}).row
   if(!String(row.mediable_type).endsWith('Message'))return unitRefusal('A media pivot has an unsupported subject.')
   link(from,'media',row.media_id,'media-pivot');link(from,'messages',row.mediable_id,'media-pivot-message')
  }
 }
 // Actual cross-entry FK cycles cannot be given an insert order by the current
 // native adapter. Soft publication/transcript cycles remain explicit closures.
 unitGroups([...source.keys()],edges.filter(edge=>edge.from!==edge.to&&(edge.evidence as {reason?:string}).reason==='foreign-key').map(edge=>({...edge,atomic:false})))
 return {destination,ownerId,preparedHash:unitHash([...prepared.mapping].sort(([a],[b])=>a.localeCompare(b))),edges,anchors:anchors.sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)))}
}
export type LegacyUnitDependencies=Awaited<ReturnType<typeof legacyUnitDependencies>>
