import type { Row,LegacyBundle } from './types'
import {relationships,isMessageMedia} from './relationships'
// What a delta may write. The seed owns its workspace configuration, and imported
// identities and execution authority are never raised or re-enabled by a legacy change.

/** Rows mapped from the legacy `projects` row: never written by a delta. */
export const projectTables=new Set(['projects','project_settings','email_settings','public_project_aliases'])
/** Identity and authority rows: a delta appends new ones and never updates existing ones. */
export const identityTables=new Set(['users','user_settings','memberships','local_devices','local_grants','local_device_settings','local_jobs','local_events'])
/** Tables only the running app writes when it mails, notifies, dispatches or calls out
 * (scripts/legacy-import/checks/rows.mjs), plus the workflow journal and the rows that reference
 * them. A delta batch removes any row its writes caused a trigger to add, so applying a delta
 * starts nothing. Each referencing table precedes the table it references, so the removal
 * deletes children before their parents and never trips a foreign key. */
export const workTables=['rer_mail_commands','conversation_outbox','email_deliveries','magic_signins','operator_notification_activity','operator_notifications','native_integration_intents','native_integration_events','integration_deliveries','context_job_events','context_jobs','lead_jobs','leads','brand_generations','csat_surveys','workflow_events']
/** Every table a delta batch removes trigger-added rows from: the work tables, then
 * `conversation_resolutions`. A delta that sets resolved_at on a conversation with a survey cycle
 * (`conversation_tracking`) makes `conversation_record_resolution` add a resolution, which the
 * widget's resolution state offers a survey for and the survey dispatcher discovers; the batch
 * removes it, after `csat_surveys` and `native_integration_events` that can reference it, so a
 * sweep makes no survey or email possible. The trigger's cycle-start update of
 * `conversation_tracking` stays. A member resolving in the seed is untouched. */
export const batchRemovedTables=[...workTables,'conversation_resolutions']

/** The conversation a legacy row belongs to, through the package context. */
export function conversationOf(table:string,row:Row,context:LegacyBundle):string|undefined{
 const {find,mediaMessages}=relationships(context)
 if(table==='conversations')return String(row.id)
 if(['messages','buckets','events','conversation_participants','message_thinkings','support_delegations','connections'].includes(table))return row.conversation_id==null?undefined:String(row.conversation_id)
 if(table==='support_delegation_events'){const job=find('support_delegations',row.support_delegation_id);return job?.conversation_id==null?undefined:String(job.conversation_id)}
 if(table==='media'){const pivot=mediaMessages.get(String(row.id)),message=find('messages',row.message_id||pivot?.mediable_id);return message?.conversation_id==null?undefined:String(message.conversation_id)}
 if(table==='mediables'&&isMessageMedia(row)){const message=find('messages',row.mediable_id);return message?.conversation_id==null?undefined:String(message.conversation_id)}
 return undefined
}

/** The parent tables a file link can name, by the model its `mediable_type` ends with. */
const linkParents:[string,string][]=[['SupportDelegation','support_delegations'],['Message','messages'],['Event','events']]
/** The conversation a file link's parent is in: a message, a delegation or an event, as far as the context holds it. */
function linkConversation(link:Row,context:LegacyBundle):string|undefined{
 const table=linkParents.find(([model])=>String(link.mediable_type).endsWith(model))?.[1]
 const parent=table?relationships(context).find(table,link.mediable_id):undefined
 return parent?.conversation_id==null?undefined:String(parent.conversation_id)
}
/** The conversations a file is linked into, through any of its links: the file's own, or its original's for a variant. */
function fileConversations(media:Row|undefined,mediaId:unknown,context:LegacyBundle):string[]{
 const {mediaLinks}=relationships(context),ids=[mediaId,media?.original_media_id].filter(id=>id!=null).map(String)
 return ids.flatMap(id=>mediaLinks.get(id)??[]).map(link=>linkConversation(link,context)).filter((id):id is string=>id!==undefined)
}

/** Every contact whose personal data a legacy row carries: the contact itself, the customer
 * of the conversation it belongs to, a contact it names directly, and for a file or file link
 * the customer of every conversation the file is linked into (by a message, a delegation or an
 * event; a variant through its original), so a file goes with each person it was shared with. */
export function contactsOf(table:string,row:Row,context:LegacyBundle):string[]{
 const {find}=relationships(context),contacts=new Set<string>()
 if(table==='contacts')contacts.add(String(row.id))
 if(row.contact_id!=null&&table!=='projects')contacts.add(String(row.contact_id))
 const conversations=[conversationOf(table,row,context)]
 if(table==='media')conversations.push(...fileConversations(row,row.id,context))
 if(table==='mediables')conversations.push(linkConversation(row,context),...fileConversations(find('media',row.media_id),row.media_id,context))
 for(const conversation of new Set(conversations)){if(conversation===undefined)continue;const owner=find('conversations',conversation)?.contact_id;if(owner!=null)contacts.add(String(owner))}
 return [...contacts]
}
