import {legacyReferences} from './references'
import type {D1Database,D1Sql} from '../../import-kit/src/d1/types'
import {DoorError} from '../../import-kit/src/door/protocol'
import {keys,quote,type LegacyTable} from './schema'

/** References made after import belong to their native owner. Inspect the whole
 * completed import before reversing its first child; keep these compact exact
 * predicates in every later reversal transaction too. */
export async function legacyUndoGuards(db:D1Database,destination:string,jobId:string):Promise<D1Sql[]>{
 const predicates:string[]=[]
 for(const [parent,references] of Object.entries(legacyReferences))for(const {child,columns} of references!){
  if(child==='move_in_contact_keys')continue
  const parentKeys=keys[parent as LegacyTable],childKeys=keys[child as LegacyTable]
  const owner=childKeys?`EXISTS(SELECT 1 FROM legacy_door_targets child_origin JOIN ik_provenance child_provenance ON child_provenance.destination=child_origin.project_id AND child_provenance.target_kind='legacy-native' AND child_provenance.target_id=child_origin.target_id AND child_provenance.job_id=?2 AND child_provenance.reversed=0 WHERE child_origin.project_id=?1 AND child_origin.table_name='${child}' AND child_origin.keys_json=json_array(${childKeys.map(key=>'child.'+quote(key)).join(',')}))`:'0'
  const relation=columns.map(([from,to])=>`child.${quote(from)}=parent.${quote(to)}`).join(' AND ')
  predicates.push(`NOT EXISTS(SELECT 1 FROM legacy_door_targets origin JOIN ik_provenance p ON p.destination=origin.project_id AND p.target_id=origin.target_id AND p.target_kind='legacy-native' AND p.job_id=?2 AND p.reversed=0 AND json_extract(p.record_json,'$.before') IS NULL JOIN ${quote(parent)} parent ON ${parentKeys.map((key,i)=>`parent.${quote(key)} IS json_extract(origin.keys_json,'$[${i}]')`).join(' AND ')} JOIN ${quote(child)} child ON ${relation} WHERE origin.project_id=?1 AND origin.table_name='${parent}' AND NOT (${owner}))`)
 }
 // The native contact door also protects sessions and soft transcript links.
 predicates.push(`NOT EXISTS(SELECT 1 FROM legacy_door_targets origin JOIN ik_provenance p ON p.target_id=origin.target_id AND p.destination=origin.project_id AND p.target_kind='legacy-native' AND p.job_id=?2 AND p.reversed=0 AND json_extract(p.record_json,'$.before') IS NULL JOIN sessions s ON s.project_id=?1 AND s.contact_id=json_extract(origin.keys_json,'$[0]') WHERE origin.project_id=?1 AND origin.table_name='contacts')`)
 const result:D1Sql[]=[];let group:string[]=[],size=0
 for(const predicate of predicates){if(group.length&&size+predicate.length>24_000){result.push({sql:group.join(' AND '),params:[destination,jobId]});group=[];size=0}group.push(predicate);size+=predicate.length}if(group.length)result.push({sql:group.join(' AND '),params:[destination,jobId]})
 for(const predicate of result)if((await db.prepare(`SELECT (${predicate.sql}) clear`).bind(...predicate.params!).first<{clear:number}>())?.clear!==1)throw new DoorError('native_reference_conflict',409)
 return result
}
