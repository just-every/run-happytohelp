import {prepareBundle} from './preparation'
import {reconcileContactKeys} from './contact-keys'
import {Buffer} from 'node:buffer'
import {validateArtifactOriginal} from '../import-kit/src/storage/originals'
import type {Env} from '../../platform/env'
import {canonicalJson,sha256,type SourceBundle} from '../import-kit/src/d1/index'
import {recordKey,type Run} from './types'
import {retainReview} from './plans'
import type {Vendor} from './types'
export async function preparePlan(env:Env,run:Run){
 if(!await reconcileContactKeys(env,run))return
 const retained=(await env.DB.prepare('SELECT record_json,serialized FROM move_in_records WHERE run_id=? ORDER BY ordinal').bind(run.id).all<any>()).results,records=[],diagnostics=JSON.parse(run.diagnostics_json),seen=new Map<string,string>(),conflicts=new Set<string>()
 for(const row of retained){const record=JSON.parse(row.record_json),key=recordKey(record);if(seen.has(key)&&(run.vendor==='intercom'||seen.get(key)!==row.serialized)){conflicts.add(key);diagnostics.push({severity:'error',code:'conflicting_duplicate_id',message:`Conflicting ${record.kind} ID ${record.sourceId}`,kind:record.kind,sourceId:record.sourceId,location:record.location})}else if(!seen.has(key)){seen.set(key,row.serialized);records.push(record)}}
 const artifacts=[];for(const file of JSON.parse(run.files_json)){const object=await env.FILES.get(file.key);if(!object)throw new Error('source_file_missing');const bytes=new Uint8Array(await object.arrayBuffer());if(sha256(bytes)!==file.sha256)throw new Error('source_file_changed');validateArtifactOriginal({name:file.name,sha256:file.sha256,size:file.size,original:{status:'available',base64:Buffer.from(bytes).toString('base64')}});artifacts.push({name:file.name,sha256:file.sha256,size:file.size,original:{status:'unavailable' as const,reason:'not-supplied' as const}})}
 const {source,prepared}=await prepareBundle(env,run,{records,artifacts,diagnostics},conflicts)
 await retainReview(env,run,source,prepared,retained.length-records.length)
}
