import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {publishActivity} from './activity'

export type MessageReadReceipt={messageId:string;readerId:string;readerRole:'contact'|'operator';readAt:string}

/** Read only the displayed message ids when supplied. No client timestamps. */
export async function recordMessageReads(env:Env,actor:Actor,conversation:{id:string;revision:number},ids?:unknown,defer?:(activity:Promise<void>)=>void):Promise<MessageReadReceipt[]>{
 if(ids!==undefined&&(!Array.isArray(ids)||ids.length>500||ids.some(id=>typeof id!=='string')))throw new HTTPException(400,{message:'Invalid read message ids'})
 const selected=ids===undefined?null:[...new Set(ids as string[])]
 if(selected?.length===0)return []
 const contact=actor.role==='contact',now=Date.now()
 // One bound JSON array keeps a catch-up read within D1's parameter limit.
 const selectedMessages=selected?' AND m.id IN (SELECT value FROM json_each(?))':''
 const predicate=`m.conversation_id=? AND m.project_id=? AND m.revision<=? AND ${contact?"m.actor_role<>'contact'":"m.actor_role='contact'"}${selectedMessages}`
 const args=[conversation.id,actor.projectId,conversation.revision,...(selected?[JSON.stringify(selected)]:[])]
 const recorded=await env.DB.batch<any>([
  env.DB.prepare(`INSERT OR IGNORE INTO context_tracked_events(id,project_id,subject_id,local_id,type,payload,created_at) SELECT lower(hex(randomblob(16))),m.project_id,c.contact_id,'read:'||m.id||':'||?,'MESSAGE_READ',json_object('message_id',m.id,'reader_id',?,'reader_role',?,'conversation_id',c.id),? FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE ${predicate}`).bind(actor.id,actor.id,contact?'contact':'operator',now,...args),
  env.DB.prepare(`INSERT INTO conversation_reads(conversation_id,user_id,revision) SELECT ?,?,coalesce(max(m.revision),0) FROM messages m WHERE m.conversation_id=? AND m.project_id=? AND m.revision<=?${selectedMessages} ON CONFLICT(conversation_id,user_id) DO UPDATE SET revision=excluded.revision WHERE excluded.revision>conversation_reads.revision`).bind(conversation.id,actor.id,...args),
  env.DB.prepare(`SELECT m.id message_id,e.created_at read_at FROM messages m JOIN context_tracked_events e ON e.project_id=m.project_id AND e.type='MESSAGE_READ' AND json_valid(e.payload) AND json_extract(e.payload,'$.message_id')=m.id AND json_extract(e.payload,'$.reader_id')=? WHERE ${predicate}`).bind(actor.id,...args),
 ])
 const receipts:MessageReadReceipt[]=recorded[2].results.map(row=>({messageId:row.message_id,readerId:actor.id,readerRole:contact?'contact':'operator',readAt:new Date(Number(row.read_at)).toISOString()}))
 if(recorded[0].meta.changes){
  const activity=publishActivity(env,actor.projectId,conversation.id,'read',{reads:receipts})
  if(defer)defer(activity.catch(()=>{console.error('Live read receipt delivery failed; the receipt is saved')}));else await activity
 }
 return receipts
}

export async function messageReadData(env:Env,message:{id:string;project_id:string}){
 const receipts=(await env.DB.prepare("SELECT json_extract(payload,'$.reader_id') reader_id,json_extract(payload,'$.reader_role') reader_role,created_at read_at FROM context_tracked_events WHERE project_id=? AND type='MESSAGE_READ' AND json_valid(payload) AND json_extract(payload,'$.message_id')=?").bind(message.project_id,message.id).all()).results
 const byRole=(role:string)=>Object.fromEntries(receipts.filter(r=>r.reader_role===role).map(r=>[String(r.reader_id),new Date(Number(r.read_at)).toISOString()]))
 return {read_by_contacts:byRole('contact'),read_by_agents:byRole('operator')}
}
