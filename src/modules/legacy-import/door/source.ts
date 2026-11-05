import type {Env} from '../../../platform/env'
import type {ImportDoorRawSource} from '../../import-kit/src/door/types'
import {DoorError} from '../../import-kit/src/door/protocol'
import {decodeLegacy} from './format'
import {prepareLegacy,recordKey,type PreparedLegacy} from './bridge'
import {indexLegacyIdentities} from './identities'
import {LEGACY_LIMITS,LEGACY_MAPPING} from './limits'

export function legacyPackageSource(env:Env,projectId:string,ownerId:string,bundleHash:()=>Promise<string>){
 let prepared:PreparedLegacy|undefined
 const source:ImportDoorRawSource={format:'raw',mapping:{version:LEGACY_MAPPING,map(record){if(!prepared)throw new Error('legacy_mapping_not_prepared');const result=prepared.mapping.get(recordKey(record.kind,record.sourceId));if(!result)throw new Error('legacy_mapping_record_missing');return result}},
  async readRaw(){throw new DoorError('seed_package_unsupported',415)},
  package:{formats:['happytohelp-legacy-chunks-v1'],maxBytes:LEGACY_LIMITS.bytes,maxSegments:LEGACY_LIMITS.segments,async read(upload,limits){
   const maxRecords=Math.min(LEGACY_LIMITS.records,limits.maxRecords),decoded=await decodeLegacy(upload,maxRecords)
   await indexLegacyIdentities(env,projectId,await bundleHash(),decoded)
   prepared=await prepareLegacy(env.DB,decoded,projectId,ownerId,maxRecords)
   return prepared.records
  }}}
 return {source}
}
