import type { Row,LegacyBundle } from './types'
import {transcriptOrder,relationships,isMessageMedia} from './relationships'
import {archiveOnly} from './archive-only'
import {lookupRows,identity,byteSlices,jsonBytes} from './d1'
import {readStates,stateKey,unchangedSinceImport} from './state'
import {contactsOf,conversationOf} from './delta-scope'
import {erasedContacts} from './lease'

/** Decisions a delta makes across its chunks before the first write.
 * A delta never renumbers the seed's transcript: legacy's new messages follow the
 * conversation's existing messages, in transcript order, and the conversation's
 * revision and last message follow them. In a conversation the seed has changed since
 * it was imported (or closed), legacy's new messages and files are held instead. */
export interface DeltaPlan {
 erased:Set<string>
 messages:Map<string,{revision:number;local_id:unknown}>
 conversations:Map<string,{revision:number;last_message_id:unknown}>
 /** `${sourceTable}:${sourceId}` of each held message or file, with its conversation. */
 held:Map<string,string>
 /** Conversations whose new legacy messages are held, with how many. */
 heldIn:Map<string,number>
 /** Conversations that gain legacy messages in this delta. */
 gaining:Set<string>
 /** Media whose bytes this delta must not upload: held, skipped, or of an erased contact. */
 withheldMedia:Set<string>
 /** Messages whose delivery id is the message id of mail the seed's Amazon SES reader recorded: the seed took that mail
  * itself, so legacy's copy is skipped. */
 skippedMessages:Set<string>
 /** New conversations whose every message in this delta is skipped. */
 skippedConversations:Set<string>
}

/** A row that goes with mail the seed already took: a skipped message or conversation, a file or file link of a skipped
 * message, or any row of a skipped conversation. */
export function skippedRow(table:string,row:Row,context:LegacyBundle,plan:DeltaPlan){
 if(table==='messages'&&plan.skippedMessages.has(String(row.id)))return true
 if(table==='mediables'&&isMessageMedia(row)&&plan.skippedMessages.has(String(row.mediable_id)))return true
 if(table==='media'){const message=row.message_id||relationships(context).mediaMessages.get(String(row.id))?.mediable_id;if(message!=null&&plan.skippedMessages.has(String(message)))return true}
 const conversation=conversationOf(table,row,context)
 return conversation!==undefined&&plan.skippedConversations.has(conversation)
}

interface SeedMessage {id:string;conversation_id:string;revision:number;local_id:string}

/** `ours`: messages this same package already appended (an interrupted run resumes with the
 * same plan, as if they were not there yet). `erased`: every contact in contact_erasures or with a
 * contact_erasure_leases row (an erasure in progress or interrupted). */
export async function planDelta(db:D1Database,{projectId,context,conversations,messages,media,ours}:{projectId:string;context:LegacyBundle;conversations:Iterable<string>;messages:Row[];media:Row[];ours:Set<string>}):Promise<DeltaPlan>{
 // Erased, being erased or left mid-erasure: the delta holds the workspace's lease (lease.ts), so no erasure starts after this read.
 const erased=new Set((await db.prepare(erasedContacts).bind(projectId).all<{contact_id:string}>()).results.map(r=>String(r.contact_id)))
 const isErased=(table:string,row:Row)=>contactsOf(table,row,context).some(contact=>erased.has(contact))
 // Mail the Amazon SES reader recorded holds its SES message id; legacy stores the same mail with that id as its delivery id.
 const localIds=[...new Set(messages.map(row=>row.local_id).filter(id=>id!==undefined&&id!==null&&id!=='').map(String))],received=new Set<string>()
 for(const part of byteSlices(localIds,jsonBytes,100))for(const row of (await db.prepare('SELECT DISTINCT ses_message_id FROM legacy_mail_s3_receipts WHERE ses_message_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(part)).all<{ses_message_id:string}>()).results)received.add(String(row.ses_message_id))
 const skippedMessages=new Set(messages.filter(row=>row.local_id!==undefined&&row.local_id!==null&&received.has(String(row.local_id))).map(row=>String(row.id)))
 const live=messages.filter(row=>!skippedMessages.has(String(row.id))&&!row.deleted_at&&!archiveOnly('messages',row,context)&&!isErased('messages',row))
 const ids=[...new Set([...conversations,...live.map(row=>String(row.conversation_id))])]
 const canonical=await lookupRows(db,'conversations',['id'],ids.map(id=>[id]))
 // A conversation the seed does not hold yet, whose every message in the delta is skipped, goes with them.
 const inDelta=new Map<string,Row[]>();for(const row of messages){const list=inDelta.get(String(row.conversation_id))??[];list.push(row);inDelta.set(String(row.conversation_id),list)}
 const skippedConversations=new Set(ids.filter(id=>{const rows=inDelta.get(id)??[];return rows.length>0&&rows.every(row=>skippedMessages.has(String(row.id)))&&!canonical.get(identity('conversations',[id]))}))
 const states=await readStates(db,ids.map(id=>['conversations',id]))
 const seed=new Map<string,SeedMessage[]>()
 for(const part of byteSlices(ids,jsonBytes,100))for(const row of (await db.prepare('SELECT id,conversation_id,revision,local_id FROM messages WHERE conversation_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(part)).all<SeedMessage>()).results){const list=seed.get(String(row.conversation_id))??[];list.push(row);seed.set(String(row.conversation_id),list)}
 const delta=new Map<string,Row[]>();for(const row of live){const list=delta.get(String(row.conversation_id))??[];list.push(row);delta.set(String(row.conversation_id),list)}
 const plan:DeltaPlan={erased,messages:new Map(),conversations:new Map(),held:new Map(),heldIn:new Map(),gaining:new Set(),withheldMedia:new Set(),skippedMessages,skippedConversations}
 const changed=new Set<string>()
 for(const id of ids){
  if(skippedConversations.has(id))continue
  const row=canonical.get(identity('conversations',[id]))
  if(row&&(row.status_category==='closed'||!await unchangedSinceImport(row,states.get(stateKey('conversations',id)))))changed.add(id)
  const seedRows=seed.get(id)??[],seedIds=new Map(seedRows.map(r=>[String(r.id),r])),prior=seedRows.filter(r=>!ours.has(String(r.id)))
  const base=prior.reduce((n,r)=>Math.max(n,Number(r.revision)),0),taken=new Set(prior.map(r=>String(r.local_id)))
  const incoming=(delta.get(id)??[]).sort(transcriptOrder),fresh=incoming.filter(r=>!seedIds.has(String(r.id))||ours.has(String(r.id)))
  for(const r of incoming){const existing=seedIds.get(String(r.id));if(existing&&!ours.has(String(r.id)))plan.messages.set(String(r.id),{revision:Number(existing.revision),local_id:existing.local_id})}
  if(fresh.length&&changed.has(id)){for(const r of fresh)plan.held.set(`messages:${r.id}`,id);plan.heldIn.set(id,fresh.length)}
  else fresh.forEach((r,i)=>{
   // The first message in transcript order keeps a delivery id; a repeat takes legacy:<id>, as the full import does.
   const local=r.local_id!==undefined&&r.local_id!==null&&r.local_id!==''&&!taken.has(String(r.local_id))?r.local_id:`legacy:${r.id}`
   taken.add(String(local));plan.messages.set(String(r.id),{revision:base+i+1,local_id:local})
  })
  if(fresh.length&&!changed.has(id)){plan.gaining.add(id);plan.conversations.set(id,{revision:base+fresh.length,last_message_id:String(fresh.at(-1)!.id)})}
  else plan.conversations.set(id,row?{revision:Number(row.revision),last_message_id:row.last_message_id}:{revision:0,last_message_id:null})
 }
 // A file the seed deleted after its import stays deleted: its bytes are not uploaded again.
 const mediaIds=media.map(row=>String(row.id)),present=await lookupRows(db,'media',['id'],mediaIds.map(id=>[id])),mediaStates=await readStates(db,mediaIds.map(id=>['media',id]))
 for(const row of media){
  const id=String(row.id),conversation=conversationOf('media',row,context)
  if(isErased('media',row)||skippedRow('media',row,context,plan)||(!present.get(identity('media',[id]))&&mediaStates.has(stateKey('media',id)))){plan.withheldMedia.add(id);continue}
  if(conversation!==undefined&&changed.has(conversation)){plan.withheldMedia.add(id);plan.held.set(`media:${id}`,conversation)}
 }
 return plan
}
