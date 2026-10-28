import {requireTicketScope,ticketScopeSql} from '../access/ticket-scope'
import type {Env} from '../../platform/env'
import {transcriptRecords,transcriptGroups} from './transcript-records'

async function* array(records:AsyncIterable<Record<string,unknown>>,check:()=>Promise<void>){
 let first=true
 yield '['
 for await(const row of records){await check();yield (first?'':',')+JSON.stringify(row);first=false}
 yield ']'
}

async function* transcriptJSON(env:Env,projectId:string,userId:string){
 const conversations=transcriptRecords(env,`SELECT id,id AS conversationId,contact_id AS contactId,assigned_to AS assignedTo,revision,created_at AS createdAt,updated_at AS updatedAt,resolved_at AS resolvedAt FROM conversations c WHERE project_id=? AND ${ticketScopeSql('?')}`,[projectId,userId])
 const messages=transcriptGroups(transcriptRecords(env,`SELECT id,conversation_id AS conversationId,local_id AS localId,actor_id AS actorId,actor_role AS actorRole,content,content_raw AS contentRaw,revision,created_at AS createdAt,erased_at AS erasedAt FROM messages m WHERE project_id=? AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=m.conversation_id AND c.project_id=m.project_id AND ${ticketScopeSql('?')})`,[projectId,userId],'revision'))
 const notes=transcriptGroups(transcriptRecords(env,`SELECT n.id,n.conversation_id AS conversationId,'native' AS source,n.user_id AS authorId,NULL AS author,n.content,n.created_at AS createdAt FROM conversation_notes n JOIN conversations c ON c.id=n.conversation_id WHERE c.project_id=? AND ${ticketScopeSql('?')}
  UNION ALL SELECT id,conversation_id AS conversationId,'imported' AS source,NULL AS authorId,author_json AS author,content,created_at AS createdAt FROM move_in_notes n WHERE project_id=? AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=n.conversation_id AND c.project_id=n.project_id AND ${ticketScopeSql('?')})`,[projectId,userId,projectId,userId]))
 const attachments=transcriptGroups(transcriptRecords(env,`SELECT id,conversation_id AS conversationId,message_id AS messageId,filename,content_type AS contentType,size,created_at AS createdAt FROM media a WHERE project_id=? AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=a.conversation_id AND c.project_id=a.project_id AND ${ticketScopeSql('?')})`,[projectId,userId]))
 try{
  yield JSON.stringify({projectId,exportedAt:new Date().toISOString(),scope:'currently_permitted_conversations'}).slice(0,-1)+',"conversations":['
  let first=true
  for await(const {conversationId:_,...conversation} of conversations){
   await requireTicketScope(env,userId,projectId,conversation.id)
   yield (first?'':',')+JSON.stringify(conversation).slice(0,-1)+',"messages":'
   first=false
   yield* array(messages.take(conversation.id),()=>requireTicketScope(env,userId,projectId,conversation.id))
   yield ',"privateNotes":'
   yield* array(notes.take(conversation.id),()=>requireTicketScope(env,userId,projectId,conversation.id))
   yield ',"attachments":'
   yield* array(attachments.take(conversation.id),()=>requireTicketScope(env,userId,projectId,conversation.id))
   yield '}'
  }
  yield ']}'
 }finally{await Promise.all([conversations.return(undefined),messages.close(),notes.close(),attachments.close()])}
}

/** Complete workspace history, including imports and empty drafts; attachment bytes stay in the workspace. */
export function exportTranscripts(env:Env,projectId:string,userId:string){
 const chunks=transcriptJSON(env,projectId,userId),encoder=new TextEncoder()
 return new ReadableStream<Uint8Array>({
  async pull(controller){try{const chunk=await chunks.next();if(chunk.done)controller.close();else controller.enqueue(encoder.encode(chunk.value))}catch(error){controller.error(error)}},
  async cancel(){await chunks.return(undefined)}
 })
}
