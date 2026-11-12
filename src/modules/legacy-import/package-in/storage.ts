import {LEGACY_CONTRACT_VERSION,LEGACY_LIMITS,type LegacyPackageManifest} from '../worker-contract'
import {digestPattern,validateManifest} from './manifest'
import {parseJson} from './body'
import {refuse} from './errors'
export const manifestKey=(sha:string)=>`legacy-package/${sha}/manifest.json`
export function custody(object:R2Object,projectId:string,sha:string){return object.customMetadata?.projectId===projectId&&object.customMetadata?.manifestSha256===sha&&object.customMetadata?.contractVersion===String(LEGACY_CONTRACT_VERSION)}
export function integrity(object:R2Object,bytes:number,sha:string){return object.size===bytes&&object.checksums.sha256!==undefined&&hex(object.checksums.sha256)===sha}
function hex(bytes:ArrayBuffer){return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('')}
export function metadata(projectId:string,sha:string){return {contractVersion:String(LEGACY_CONTRACT_VERSION),projectId,manifestSha256:sha}}
export async function heldManifest(bucket:R2Bucket,projectId:string,sha:string):Promise<LegacyPackageManifest>{
 const object=await bucket.get(manifestKey(sha))
 if(!object||!custody(object,projectId,sha))refuse(404,'package_not_found','Package not found')
 if(object.size>LEGACY_LIMITS.manifestBytes||!integrity(object,object.size,sha))refuse(409,'custody_conflict','Stored package integrity could not be confirmed')
 return validateManifest(parseJson(new Uint8Array(await object.arrayBuffer())))
}
export async function putImmutable(bucket:R2Bucket,key:string,bytes:Uint8Array,sha:string,customMetadata:Record<string,string>,manifestSha:string){
 const prior=await bucket.head(key)
 const check=(object:R2Object)=>{
  if(!custody(object,customMetadata.projectId,manifestSha))refuse(404,'package_not_found','Package not found')
  if(!integrity(object,bytes.byteLength,sha)||Object.entries(customMetadata).some(([k,v])=>object.customMetadata?.[k]!==v))refuse(409,'file_conflict','Stored file differs from this package')
 }
 if(prior){check(prior);return true}
 const accepted=await bucket.put(key,bytes,{sha256:sha,onlyIf:{etagDoesNotMatch:'*'},customMetadata})
 if(accepted)return false
 const raced=await bucket.head(key);if(!raced)refuse(409,'file_conflict','File changed during upload');check(raced);return true
}
export function requireSha(sha:string){if(!digestPattern.test(sha))refuse(400,'invalid_request','Invalid manifest fingerprint');return sha}
