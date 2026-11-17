import type {LegacyBundle,Row} from './types'
import {relationships,isMessageMedia} from './relationships'
const model=(link:Row)=>String(link.mediable_type).split('\\').at(-1)
const ordered=(a:Row,b:Row)=>Number(a.order??0)-Number(b.order??0)||String(a.tag??'').localeCompare(String(b.tag??''))||String(a.mediable_type).localeCompare(String(b.mediable_type))||String(a.mediable_id).localeCompare(String(b.mediable_id))
/** Decisions use all original pivots, never input iteration order. One native
 * media row has one message_id. Unrepresentable links remain named holds. */
export function mediaAssociations(row:Row,bundle:LegacyBundle){
 const related=relationships(bundle),links=[...(related.mediaLinks.get(String(row.id))??[])].sort(ordered)
 const live=(table:string,parent:Row|undefined)=>{
  if(!parent||parent.deleted_at)return false
  const conversation=table==='conversations'?parent:related.find('conversations',parent.conversation_id)
  return !conversation?.deleted_at&&!related.find('contacts',conversation?.contact_id)?.deleted_at&&!related.find('projects',parent.project_id??conversation?.project_id)?.deleted_at
 }
 const messages=links.filter(isMessageMedia).map(link=>({link,message:related.find('messages',link.mediable_id)})).filter((p):p is {link:Row;message:Row}=>live('messages',p.message))
 if(row.message_id&&!messages.some(p=>String(p.message.id)===String(row.message_id))){const message=related.find('messages',row.message_id);if(live('messages',message))messages.push({link:{mediable_id:row.message_id,mediable_type:'Message'},message:message!})}
 const notes=links.filter(link=>model(link)==='Event').map(link=>related.find('events',link.mediable_id)).filter((note):note is Row=>!!note&&note.type==='INTERNAL_NOTE'&&live('events',note))
 const conversations=new Set(messages.map(p=>String(p.message.conversation_id)))
 const privateLinks=links.some(link=>['Event','SupportDelegation'].includes(model(link)??''))
 const selected=!privateLinks&&conversations.size<=1?messages[0]?.message:undefined
 const represented=selected?String(selected.id):null
 const holds=links.filter(link=>isMessageMedia(link)?String(link.mediable_id)!==represented:privateLinks).map(link=>`media ${row.id} link ${link.mediable_type}:${link.mediable_id} tag=${String(link.tag??'')} order=${String(link.order??'')}: ${privateLinks?'private event/delegation association; never exposed as a public message file':conversations.size>1?'multiple conversation audiences cannot share one native media row': 'additional or deleted message association has no native pivot destination'}`)
 return {links,message:selected,notes,privateLinks,blocked:privateLinks||conversations.size>1,holds}
}
