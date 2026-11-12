import type {LegacyBundle,MappedRow,Row} from '../types'
import type {MappingProfile} from './profile'
import {relationships} from '../relationships'
import {archiveOnly} from '../archive-only'
import {mapCore} from '../map-core'

/** A historical note has no native user FK. Reuse the media mapper with its
 * conversation derived from the retained Event pivot, then link its original
 * note ID through the existing snapshot reader's attachment table. */
export function historicalNoteMedia(row:Row,bundle:LegacyBundle,profile:MappingProfile):MappedRow[]{
 const related=relationships(bundle),notes=(related.mediaLinks.get(String(row.id))??[])
  .filter(link=>String(link.mediable_type).split('\\').at(-1)==='Event')
  .map(link=>related.find('events',link.mediable_id))
  .filter((note):note is Row=>!!note&&note.type==='INTERNAL_NOTE'&&!archiveOnly('events',note,bundle))
 const home=row.conversation_id??notes[0]?.conversation_id
 if(notes.some(note=>String(note.conversation_id)!==String(home)))throw new Error('unsupported_note_media_scope')
 const targets=mapCore('media',home?{...row,conversation_id:home,uploaded_by:row.uploaded_by??notes[0]?.agent_id}:row,bundle,profile)??[]
 if(!targets.some(target=>target.table==='media'))return targets
 return [...targets,...notes.map(note=>({table:'move_in_note_media',key:['note_id','media_id'],row:{note_id:String(note.id),media_id:String(row.id)}}))]
}
