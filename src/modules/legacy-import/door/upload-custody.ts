import type {Env} from '../../../platform/env'
import type {D1Database} from '../../import-kit/src/d1/types'
import type {DoorRequest,ImportDoorResolvedSource} from '../../import-kit/src/door/types'
import {packageUpload} from '../../import-kit/src/door/package'
import type {UploadRow} from '../../import-kit/src/door/uploads'
import {DoorError} from '../../import-kit/src/door/protocol'
import {decodeLegacy} from './format'
import {indexLegacyIdentities} from './identities'
import {LEGACY_LIMITS,LEGACY_NAMESPACE} from './limits'

async function forget(db:D1Database,installation:string,upload:UploadRow,segments:UploadRow[]){
 const matches=[{sql:'id=? AND installation_id=? AND namespace=?',params:[upload.id,installation,LEGACY_NAMESPACE]},...segments.map(segment=>({sql:"installation_id=? AND namespace=? AND name='rer-segment' AND bundle_sha256=? AND total_bytes=?",params:[installation,LEGACY_NAMESPACE,segment.bundle_sha256,segment.total_bytes]}))]
 await db.batch(matches.flatMap(match=>[db.prepare(`DELETE FROM ik_door_chunks WHERE upload_id IN (SELECT id FROM ik_door_uploads WHERE ${match.sql})`).bind(...match.params),db.prepare(`DELETE FROM ik_door_uploads WHERE ${match.sql}`).bind(...match.params)]))
}
/** A completed upload may precede Plan by days. Index its privacy aliases as
 * soon as its complete logical package exists, without creating any plan or
 * business row. Missing segments remain resumable; foreign scopes stay closed. */
export async function indexCompletedLegacyUpload(env:Env,database:D1Database,installation:string,project:string,source:ImportDoorResolvedSource){
 const pending=(await database.prepare("SELECT u.* FROM ik_door_uploads u JOIN ik_door_scopes s ON s.installation_id=u.installation_id AND s.namespace=u.namespace AND s.destination=? WHERE u.installation_id=? AND u.namespace=? AND u.name='rer-package.json' AND NOT EXISTS(SELECT 1 FROM legacy_door_package_audits a WHERE a.installation_id=u.installation_id AND a.upload_id=u.id AND a.bundle_sha256=u.bundle_sha256) ORDER BY u.id LIMIT 100").bind(project,installation,LEGACY_NAMESPACE).all<UploadRow>()).results
 for(const upload of pending){const segments:UploadRow[]=[]
  try{const pkg=await packageUpload({options:{database,...source,limits:{maxBytes:LEGACY_LIMITS.bytes,maxRecords:LEGACY_LIMITS.records,maxRecordBytes:LEGACY_LIMITS.recordBytes}},access:{installationId:installation,namespace:LEGACY_NAMESPACE,maxBytes:2*1024*1024,maxChunks:32,maxRecords:LEGACY_LIMITS.records}} as DoorRequest,upload,rows=>segments.push(...rows)),decoded=await decodeLegacy(pkg,LEGACY_LIMITS.records)
   await indexLegacyIdentities({...env,DB:database as unknown as Env['DB']},project,upload.bundle_sha256,decoded)
   await database.batch([database.prepare('INSERT OR IGNORE INTO legacy_door_package_audits(project_id,installation_id,upload_id,bundle_sha256) VALUES(?,?,?,?)').bind(project,installation,upload.id,upload.bundle_sha256)])
  }catch(error){if(error instanceof DoorError&&['package_segment_missing','upload_incomplete'].includes(error.code))continue;if(error instanceof DoorError&&['source_erased','source_credential','source_invalid_or_credential_source_data'].includes(error.code)){await forget(database,installation,upload,segments);throw error}if(error instanceof DoorError&&['seed_package_unsupported','invalid_package'].includes(error.code)){await database.batch([database.prepare('INSERT OR IGNORE INTO legacy_door_package_audits(project_id,installation_id,upload_id,bundle_sha256) VALUES(?,?,?,?)').bind(project,installation,upload.id,upload.bundle_sha256)]);continue};throw error}
 }
}
