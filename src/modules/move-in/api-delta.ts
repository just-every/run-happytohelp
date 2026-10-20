import type {Env} from '../../platform/env'
import type {SourceBundle,TargetRow} from '../import-kit/src/d1/index'
import {canonicalJson,sha256} from '../import-kit/src/d1/index'
import {sourceIdentity} from '../import-kit/src/provenance/identity'
import type {PreparedMapping,Run} from './types'
import {recordKey} from './types'
import {apiRun} from './api-store'
/** A source version gets a new journal identity while retaining the stable native ID.
 * Base verifies and archives the exact predecessor; native edits remain conflicts. */
export async function versionApiDelta(env:Env,run:Run,source:SourceBundle,prepared:PreparedMapping,native:Map<string,TargetRow>){
 const api=await apiRun(env,run.id);if(!api)return
 for(const record of source.records){const key=recordKey(record),effects=prepared.effects.get(key)??[]
  for(const effect of effects)(effect.value as any).source.api_import=true
  if(api.mode!=='delta')continue
  const reason=prepared.rejections.get(key)
  if(reason&&!['native_target_conflict','source_changed_conflict'].includes(reason))continue
  const existing=effects.map(effect=>native.get(`${effect.targetKind}/${effect.targetId}`))
  if(!existing.some(Boolean))continue
  if(!effects.length||existing.some(row=>!row)){prepared.rejections.set(key,'native_target_conflict');continue}
  const version=`${record.sourceId}@${record.payloadHash}`,identity=sourceIdentity(run.project_id,run.vendor,record.kind,version),prior=await env.DB.prepare('SELECT identity FROM ik_sources WHERE identity=?').bind(identity).first()
  if(prior){prepared.rejections.delete(key);prepared.known.add(key);continue}
  let changed=false,pristine=true
  for(let index=0;index<effects.length;index++){
   const effect=effects[index],before=existing[index]!,current=await env.DB.prepare('SELECT record_json FROM ik_provenance WHERE destination=? AND target_kind=? AND target_id=? AND reversed=0').bind(run.project_id,effect.targetKind,effect.targetId).first<{record_json:string}>(),p=current?JSON.parse(current.record_json):null
   if(!p||p.appliedRevision!==before.revision||p.valueHash!==sha256(canonicalJson(before.value))||(before.value as any).source.api_import!==true){pristine=false;break}
   if(canonicalJson(before.value)!==canonicalJson(effect.value))changed=true
   effect.expectedRevision=before.revision
  }
  if(!pristine){prepared.rejections.set(key,'native_target_conflict');continue}
  prepared.rejections.delete(key)
  if(!changed){prepared.known.add(key);continue}
  record.sourceId=version
  prepared.effects.set(recordKey(record),effects);prepared.effects.delete(key)
  if(prepared.omissions.has(key)){prepared.omissions.set(recordKey(record),prepared.omissions.get(key)!);prepared.omissions.delete(key)}
 }
}
