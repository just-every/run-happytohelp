import type {ApiClient} from './types'
import {enc,items,zendeskNext} from './common'
import {readEmailHeaders} from './email-headers'
// https://developer.zendesk.com/api-reference/ticketing/tickets/email_notifications/
export async function zendeskEmailEvidence(client:ApiClient,ticketId:unknown,comments:any[]):Promise<void>{
 const notifications:any[]=[],seen=new Set<string>()
 let path:string|null=`/api/v2/email_notifications?filter[ticket_id]=${enc(ticketId)}&per_page=100`,complete=true,reason:string|undefined
 while(path){
  if(seen.has(path))throw new Error('zendesk_email_notification_pagination_cycle');seen.add(path)
  const url=new URL(path,'https://reader.invalid')
  if(!/^\/api\/v2\/email_notifications(?:\.json)?$/.test(url.pathname)||url.searchParams.get('filter[ticket_id]')!==String(ticketId))throw new Error('zendesk_email_notification_scope_invalid')
  const data=await client.get(path)
  notifications.push(...items(data.email_notifications,'zendesk_email_notifications'))
  // Some documented response examples omit pagination altogether. Keep actual
  // evidence, but never turn an absent cursor receipt into a completeness claim.
  if(!data.meta&&!Object.hasOwn(data,'next_page')){complete=false;reason='pagination_metadata_missing';break}
  path=zendeskNext(data)
 }
 for(const comment of comments){
  if(comment.public!==true)continue
  const matches=notifications.filter(n=>n&&String(n.ticket_id)===String(ticketId)&&String(n.comment_id)===String(comment.id)&&typeof n.message_id==='string'&&n.message_id.trim())
  comment._move_in_email_evidence={source:'zendesk_email_notifications',status:matches.length?'available':'unavailable',coverage:'outbound_notifications_only',complete,notifications:matches,...(reason?{reason}:!matches.length?{reason:'no_matching_notification'}:{})}
 }
}
// https://developer.helpscout.com/mailbox-api/endpoints/conversations/threads/thread-source-json/
// Original incoming email source is retained by Help Scout for two years.
export async function helpScoutEmailEvidence(client:ApiClient,conversation:any,thread:any):Promise<void>{
 if(thread.type!=='customer'||(thread.source?.type??conversation.type)!=='email')return
 const source='helpscout_original_source'
 let response:any
 try{response=await client.get(`https://api.helpscout.net/v2/conversations/${enc(conversation.id)}/threads/${enc(thread.id)}/original-source`,{maxBytes:32*1024*1024})}
 catch(error){if(((error as any)?.status??(error as any)?.statusCode)!==404)throw error;thread._move_in_email_evidence={source,status:'unavailable',reason:'original_source_not_found'};return}
 if(typeof response?.original!=='string'){thread._move_in_email_evidence={source,status:'unavailable',reason:'original_source_response_invalid'};return}
 try{
  const headers=readEmailHeaders(response.original)
  thread._move_in_email_evidence={source,status:'available',headers,...(!headers['message-id']?.length?{reason:'message_id_header_missing'}:{})}
 }catch(error){thread._move_in_email_evidence={source,status:'unavailable',reason:error instanceof Error?error.message:'original_source_header_invalid'}}
}
