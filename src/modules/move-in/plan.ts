import {prepareBundle} from './preparation'
import {reconcileContactKeys} from './contact-keys'
import {Buffer} from 'node:buffer'
import {validateArtifactOriginal} from '../import-kit/src/storage/originals'
import type {Env} from '../../platform/env'
import {sha256} from '../import-kit/src/d1/index'
import type {Run} from './types'
import {reviewRecords} from './review-records'
import {retainReview} from './plans'
export async function preparePlan(env:Env,run:Run){
 if(!await reconcileContactKeys(env,run))return
 const {records,diagnostics,conflicts,duplicates}=await reviewRecords(env,run)
 const artifacts=[];for(const file of JSON.parse(run.files_json)){const object=await env.FILES.get(file.key);if(!object)throw new Error('source_file_missing');const bytes=new Uint8Array(await object.arrayBuffer());if(sha256(bytes)!==file.sha256)throw new Error('source_file_changed');validateArtifactOriginal({name:file.name,sha256:file.sha256,size:file.size,original:{status:'available',base64:Buffer.from(bytes).toString('base64')}});artifacts.push({name:file.name,sha256:file.sha256,size:file.size,original:{status:'unavailable' as const,reason:'not-supplied' as const}})}
 const {source,prepared}=await prepareBundle(env,run,{records,artifacts,diagnostics},conflicts)
 await retainReview(env,run,source,prepared,duplicates)
}
