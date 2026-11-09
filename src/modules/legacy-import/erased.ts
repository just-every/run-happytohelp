import type { Row,LegacyBundle } from './types'
import {contactsOf} from './delta-scope'
import {erasedContacts} from './lease'

/** The workspace's contacts every legacy import treats as erased: erased, being erased, or left mid-erasure. Read under
 * the workspace's lease (lease.ts), so no erasure starts after this read while the import writes. */
export async function readErased(db:D1Database,projectId:string){
 return new Set((await db.prepare(erasedContacts).bind(projectId).all<{contact_id:string}>()).results.map(r=>String(r.contact_id)))
}

/** A legacy row carries the personal data of an erased contact (delta-scope.ts `contactsOf`). */
export const ofErased=(erased:Set<string>,table:string,row:Row,context:LegacyBundle)=>erased.size>0&&contactsOf(table,row,context).some(contact=>erased.has(contact))

/** Whether a native media row holds the file (one of `ids`) or its R2 key. An erasure keeps such a file: it stages a legacy
 * file only when no native media row holds it, and the seed's media only in the erased contact's conversations, so a file
 * linked into her conversation that the seed holds for another person stays (contact-erasure/objects.ts). An import removes
 * an erased contact's leftover file only when this is false: then no erasure could have seen it (its media chunk was never
 * applied) and nobody else's attachment points at it. */
export async function heldByNativeMedia(db:D1Database,ids:unknown[],key:string){
 return Boolean(await db.prepare('SELECT 1 FROM media WHERE id IN (SELECT value FROM json_each(?1)) OR object_key=?2 LIMIT 1').bind(JSON.stringify(ids.map(String)),key).first())
}

/** The ids of the media rows among `media` that belong to an erased contact: their files are never uploaded, and one an
 * earlier run left in R2 is removed (scripts/legacy-import/objects.mjs). */
export function erasedMediaOf(erased:Set<string>,media:Iterable<Row>,context:LegacyBundle){
 const ids=new Set<string>()
 if(erased.size)for(const row of media)if(ofErased(erased,'media',row,context))ids.add(String(row.id))
 return ids
}
