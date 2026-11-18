import type {Row, LegacyBundle} from './types'
import {relationships} from './relationships'
// Retain deleted legacy records without making their content visible again.
export function archiveOnly(table:string,row:Row,bundle:LegacyBundle):boolean {
 const {find}=relationships(bundle)
 if(row.deleted_at)return true
 const project=table==='projects'?row:find('projects',row.project_id)
 if(project?.deleted_at)return true
 if(find('contacts',row.contact_id)?.deleted_at)return true
 const conversation=table==='conversations'?row:find('conversations',row.conversation_id)
 if(conversation?.deleted_at||find('projects',conversation?.project_id)?.deleted_at||find('contacts',conversation?.contact_id)?.deleted_at)return true
 if(table==='project_users'&&find('users',row.user_id)?.deleted_at)return true
 if(table==='conversation_participants'&&find('contacts',row.contact_id)?.deleted_at)return true
 if(table==='support_delegation_events'){
  const parent=find('support_delegations',row.support_delegation_id??row.job_id)
  if(parent&&archiveOnly('support_delegations',parent,bundle))return true
 }
 if(table==='article_categories'){
  const article=find('articles',row.article_id),category=find('categories',row.category_id)
  if(article&&archiveOnly('articles',article,bundle)||category&&archiveOnly('categories',category,bundle))return true
 }
 if(table==='media'){
  const tables:Record<string,string>={Message:'messages',Event:'events',Article:'articles',Project:'projects',User:'users',AI:'ais',SupportDelegation:'support_delegations'}
  const links=relationships(bundle).mediaLinks.get(String(row.id))??[]
  const parents=links.map(link=>{const table=tables[String(link.mediable_type).split('\\').at(-1)??''];return {table,parent:table?find(table,link.mediable_id):undefined}})
  if(parents.length&&parents.every(({table,parent})=>parent&&archiveOnly(table,parent,bundle)))return true
  // A deleted pivot must not suppress a different live link just because it
  // happened to be read last. All-deleted message associations remain private.
  const ids=[row.message_id,...(relationships(bundle).mediaLinks.get(String(row.id))??[]).filter(link=>String(link.mediable_type).endsWith('Message')).map(link=>link.mediable_id)].filter(id=>id!=null)
  const messages=ids.map(id=>find('messages',id)).filter((r):r is Row=>!!r)
  if(messages.length&&messages.every(message=>message.deleted_at||archiveOnly('messages',message,bundle))&&!(relationships(bundle).mediaLinks.get(String(row.id))??[]).some(link=>!String(link.mediable_type).endsWith('Message')))return true
 }
 return false
}
