import type {Env} from '../../platform/env'
import {custodyHash} from './custody-hash'
import {objectKey} from './run-store'
import {reviewFingerprint,type ReviewManifest} from './plans'
import {LIMITS,MAPPING_VERSION,type Run} from './types'

export interface CustodyFile {key:string;sha256:string;size:number;version?:string}
const group=(review:ReviewManifest)=>[review.original,...review.artifacts]
function checkFile(run:Run,file:CustodyFile){if(!file.key.startsWith(objectKey(run,''))||file.size>LIMITS.inputBytes)throw new Error('source_custody_changed')}
export async function readReview(env:Env,run:Run,fingerprint:string){
 const object=await env.FILES.get(objectKey(run,`review/${fingerprint}`));if(!object)throw new Error('reviewed_plan_missing');const review=await object.json<ReviewManifest>();if(reviewFingerprint(review)!==fingerprint||review.fingerprint!==fingerprint||review.projectId!==run.project_id||review.actorId!==run.actor_id||review.vendor!==run.vendor||review.mappingVersion!==MAPPING_VERSION||!review.batches.length)throw new Error('reviewed_plan_changed');return review
}
/** The review binds upload generations, not etags (which may repeat for equal
 * bytes). Approval still hashes every byte before authorizing any kit write. */
export async function custodyVersions(env:Env,run:Run,files:CustodyFile[]){
 return Promise.all(files.map(async file=>{checkFile(run,file);const object=await env.FILES.head(file.key);if(!object||object.size!==file.size)throw new Error('source_custody_changed');return {...file,version:object.version}}))
}
export async function verifyGroupCustody(env:Env,run:Run,review:ReviewManifest){
 for(const file of group(review))await verifyFile(env,run,file)
}
async function verifyFile(env:Env,run:Run,file:CustodyFile){checkFile(run,file);const object=await env.FILES.get(file.key);if(!object||object.size!==file.size||await custodyHash(object.body,file.size)!==file.sha256)throw new Error('source_custody_changed')}
/** Applying/undoing proves approval already hashed these exact upload versions.
 * The review fingerprint and existing D1 checkpoint fence bind that proof. R2
 * listing is strongly consistent. A changed generation must prove its bytes
 * again: an identical racing private write is harmless, as before. Older
 * reviews have no generation proof and retain their full byte checks. */
export async function verifyApprovedCustody(env:Env,run:Run,review:ReviewManifest){
 const files=group(review);for(const file of files)checkFile(run,file)
 if(files.some(file=>typeof file.version!=='string'||!file.version))return verifyGroupCustody(env,run,review)
 const pending=new Map(files.map(file=>[file.key,file]));let cursor:string|undefined
 do{const page=await env.FILES.list({prefix:objectKey(run,''),limit:1000,...(cursor?{cursor}:{})})
  for(const object of page.objects){const file=pending.get(object.key);if(!file)continue;if(object.size!==file.size)throw new Error('source_custody_changed');if(object.version!==file.version)await verifyFile(env,run,file);pending.delete(object.key)}
  if(!pending.size)return
  cursor=page.truncated?page.cursor:undefined
 }while(cursor)
 throw new Error('source_custody_changed')
}
