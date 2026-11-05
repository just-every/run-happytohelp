import type {D1Database} from '../../import-kit/src/d1/types'
import type {DoorRequest} from '../../import-kit/src/door/types'
import {bundleBytes,type UploadRow} from '../../import-kit/src/door/uploads'
import {LEGACY_LIMITS,LEGACY_NAMESPACE} from './limits'

/** Base owns admission. Translate only a known package-header refusal after its
 * verified namespace resolver ran; never reinterpret another grant failure. */
export async function legacyHeaderRefusal(database:D1Database,installationId:string,input:Record<string,unknown>){
 if(typeof input.uploadId!=='string')return null
 const upload=await database.prepare("SELECT * FROM ik_door_uploads WHERE id=? AND installation_id=? AND namespace=? AND name='rer-package.json'").bind(input.uploadId,installationId,LEGACY_NAMESPACE).first<UploadRow>();if(!upload)return null
 let value:any;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bundleBytes({options:{database},access:{installationId,namespace:LEGACY_NAMESPACE}} as DoorRequest,upload)))}catch{return null}
 if(value?.format!=='rer-door-package/1'||value?.source?.format!=='happytohelp-legacy-chunks-v1')return {error:'seed_package_unsupported',status:415,reason:'This namespace accepts only the declared complete legacy database package.'}
 if(value.stream?.bytes>LEGACY_LIMITS.bytes||value.segments?.length>LEGACY_LIMITS.segments)return {error:'legacy_package_exceeds_runtime_limit',status:413,reason:'The complete legacy package exceeds the eager runtime allowance; no subset was imported.'}
 return null
}
