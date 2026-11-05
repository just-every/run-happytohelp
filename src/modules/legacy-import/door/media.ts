import {LEGACY_LIMITS} from './limits'
import {Buffer} from 'node:buffer'
import type {Env} from '../../../platform/env'
import {sha256} from '../../import-kit/src/provenance/identity'

/** Called only after the ordinary native ticket/contact/private-note check.
 * A legacy custody key is terminal: missing/corrupt chunks never fall to R2. */
export async function legacyMedia(env:Pick<Env,'DB'>,projectId:string,conversationId:string,mediaId:string,objectKey:string):Promise<Uint8Array|null|undefined>{
 if(!objectKey.startsWith('legacy-door/'))return undefined
 const rows=(await env.DB.prepare('SELECT b.*,m.size AS native_media_bytes FROM legacy_door_blob_chunks b JOIN media m ON m.id=b.media_id AND m.project_id=b.project_id WHERE b.project_id=? AND b.media_id=? AND m.conversation_id=? ORDER BY b.ordinal').bind(projectId,mediaId,conversationId).all<any>()).results
 if(!rows.length)return null
 const first=rows[0];if(rows.length!==first.total_chunks||objectKey!==`legacy-door/${projectId}/${encodeURIComponent(mediaId)}/${first.sha256}`||!Number.isSafeInteger(first.total_bytes)||first.total_bytes<0||first.total_bytes>LEGACY_LIMITS.fileBytes||first.total_bytes!==first.native_media_bytes)return null
 const bytes=new Uint8Array(first.total_bytes);let offset=0
 for(const [ordinal,row] of rows.entries()){if(row.ordinal!==ordinal||row.total_chunks!==first.total_chunks||row.total_bytes!==first.total_bytes||row.sha256!==first.sha256||row.object_key!==first.object_key||row.file_name!==first.file_name||row.identity_json!==first.identity_json)return null;const chunk=Buffer.from(row.base64,'base64');if(chunk.toString('base64')!==row.base64||sha256(chunk)!==row.chunk_sha256||offset+chunk.length>bytes.length)return null;bytes.set(chunk,offset);offset+=chunk.length}
 return offset===bytes.length&&sha256(bytes)===first.sha256?bytes:null
}
