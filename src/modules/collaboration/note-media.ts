import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
export function noteMediaIds(value:unknown){
 if(value===undefined)return []
 if(!Array.isArray(value)||value.length>20||value.some(id=>typeof id!=='string'||!id||id.length>200))throw new HTTPException(400,{message:'Choose up to 20 attachments.'})
 return [...new Set(value)] as string[]
}
export async function prepareNoteMedia(env:Env,actor:Actor,conversationId:string,value:unknown){
 const ids=noteMediaIds(value)
 const sql=`SELECT 1 WHERE (SELECT count(*) FROM media m WHERE m.id IN (SELECT value FROM json_each(?)) AND m.project_id=? AND m.conversation_id=? AND m.uploaded_by=? AND m.message_id IS NULL AND NOT EXISTS(SELECT 1 FROM conversation_note_media nm WHERE nm.media_id=m.id) AND NOT EXISTS(SELECT 1 FROM move_in_note_media nm WHERE nm.media_id=m.id))=?`
 const params=[JSON.stringify(ids),actor.projectId,conversationId,actor.id,ids.length]
 if(!await env.DB.prepare(sql).bind(...params).first())throw new HTTPException(403,{message:'Attachments must be your unused uploads to this ticket.'})
 const media=(await env.DB.prepare('SELECT id,filename,content_type,size FROM media WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<{id:string;filename:string;content_type:string;size:number}>()).results
 return {ids,guard:{sql,params},media:media.map(row=>({...row,filename_original:row.filename,aggregate_type:row.content_type.startsWith('image/')?'image':'file',url:`/api/conversations/${encodeURIComponent(conversationId)}/media/${encodeURIComponent(row.id)}`}))}
}
/** Hydrate private transcript events in one scoped query for the requested note page. */
export async function noteMediaData(env:Env,projectId:string,noteIds:string[]){
 const byNote=new Map<string,Record<string,unknown>[]>()
 if(!noteIds.length)return byNote
 const rows=await env.DB.prepare(`SELECT nm.note_id AS note_id,n.conversation_id AS conversation_id,m.id AS id,m.filename AS filename,m.content_type AS content_type,m.size AS size,m.created_at AS created_at FROM conversation_note_media nm JOIN conversation_notes n ON n.id=nm.note_id JOIN conversations c ON c.id=n.conversation_id JOIN media m ON m.id=nm.media_id AND m.project_id=c.project_id AND m.conversation_id=c.id WHERE c.project_id=?1 AND n.id IN (SELECT value FROM json_each(?2))
 UNION ALL SELECT nm.note_id,n.conversation_id,m.id,m.filename,m.content_type,m.size,m.created_at FROM move_in_note_media nm JOIN move_in_notes n ON n.id=nm.note_id AND n.project_id=nm.project_id JOIN media m ON m.id=nm.media_id AND m.project_id=nm.project_id AND m.conversation_id=nm.conversation_id WHERE nm.project_id=?1 AND n.id IN (SELECT value FROM json_each(?2)) ORDER BY note_id,created_at,id`).bind(projectId,JSON.stringify(noteIds)).all<{note_id:string;conversation_id:string;id:string;filename:string;content_type:string;size:number}>()
 for(const row of rows.results){const media=byNote.get(row.note_id)||[];media.push({id:row.id,filename:row.filename,filename_original:row.filename,content_type:row.content_type,size:row.size,aggregate_type:row.content_type.startsWith('image/')?'image':'file',url:`/api/conversations/${encodeURIComponent(row.conversation_id)}/media/${encodeURIComponent(row.id)}`});byNote.set(row.note_id,media)}
 return byNote
}
