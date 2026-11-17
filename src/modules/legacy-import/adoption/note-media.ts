import {mediaAssociations} from '../media-links'
import type {LegacyBundle,MappedRow,Row} from '../types'
import type {MappingProfile} from './profile'
import {relationships,useRelationships} from '../relationships'
import {mapCore} from '../map-core'

/** A historical note has no native user FK. Reuse the media mapper with its
 * conversation derived from the retained Event pivot, then link its original
 * note ID through the existing snapshot reader's attachment table. */
export function historicalNoteMedia(row:Row,bundle:LegacyBundle,profile:MappingProfile):MappedRow[]{
 const {notes}=mediaAssociations(row,bundle)
 const home=row.conversation_id??notes[0]?.conversation_id
 if(notes.some(note=>String(note.conversation_id)!==String(home)))throw new Error('unsupported_note_media_scope')
 // Reuse the ordinary mapper without any public-message pivots. The original
 // source and all its links stay unchanged in the private journal/context.
 const related=relationships(bundle),privateContext=notes.length?{...bundle,tables:{...bundle.tables,mediables:[]}}:bundle
 if(notes.length){useRelationships(privateContext,{...related,mediaLinks:{get:()=>[]},mediaMessages:{get:()=>undefined}})}
 const targets=mapCore('media',notes.length&&home?{...row,project_id:related.find('conversations',home)?.project_id,conversation_id:home,message_id:null,uploaded_by:row.uploaded_by??notes[0]?.agent_id}:row,privateContext,profile)??[]
 if(!targets.some(target=>target.table==='media'))return targets
 return [...targets,...notes.map(note=>({table:'move_in_note_media',key:['note_id','media_id'],row:{note_id:String(note.id),media_id:String(row.id)}}))]
}
