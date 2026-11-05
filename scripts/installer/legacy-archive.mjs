import {createHash} from 'node:crypto'
const quoted=name=>'"'+name.replaceAll('"','""')+'"'
/** Imported customer originals remain ordinary SQL inventory. Verify complete
 * chunk custody before a portable restore publishes any table. */
export async function legacyArchiveSafety({db,tables}){
 if(!tables.legacy_door_blob_chunks)return
 const table=quoted(tables.legacy_door_blob_chunks),objects=(await db.prepare(`SELECT project_id,media_id,COUNT(*) n,MIN(total_chunks) chunks,MAX(total_chunks) max_chunks,MIN(total_bytes) bytes,MAX(total_bytes) max_bytes,MIN(sha256) sha,MAX(sha256) max_sha FROM ${table} GROUP BY project_id,media_id`).all()).results
 for(const object of objects){
  if(object.n!==object.chunks||object.chunks!==object.max_chunks||object.bytes!==object.max_bytes||object.sha!==object.max_sha)throw Error('IMPORT_LEGACY_BLOB_CUSTODY')
  const hash=createHash('sha256');let ordinal=0,size=0
  while(ordinal<object.n){const rows=(await db.prepare(`SELECT ordinal,base64,chunk_sha256 FROM ${table} WHERE project_id=? AND media_id=? AND ordinal>=? ORDER BY ordinal LIMIT 32`).bind(object.project_id,object.media_id,ordinal).all()).results;if(!rows.length)throw Error('IMPORT_LEGACY_BLOB_CUSTODY')
   for(const row of rows){const bytes=Buffer.from(row.base64,'base64');if(row.ordinal!==ordinal++||bytes.toString('base64')!==row.base64||createHash('sha256').update(bytes).digest('hex')!==row.chunk_sha256)throw Error('IMPORT_LEGACY_BLOB_CUSTODY');hash.update(bytes);size+=bytes.length}
  }
  if(size!==object.bytes||hash.digest('hex')!==object.sha)throw Error('IMPORT_LEGACY_BLOB_CUSTODY')
 }
 // Existing portability deliberately excludes device/execution authority. Its
 // source history stays in kit custody; excluded native rows cannot leave a
 // dangling native-set marker on the restored, disabled door.
 if(tables.legacy_door_targets)await db.prepare(`DELETE FROM ${quoted(tables.legacy_door_targets)} WHERE table_name IN ('local_grants','local_devices','local_device_settings','local_jobs','local_events')`).run()
}
