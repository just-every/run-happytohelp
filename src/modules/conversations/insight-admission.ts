import {renderKnowledgeFields} from '../knowledge/reference-store'
import {readerSet} from '../knowledge/door'
import {admitMessage,atomicMessage,reservedLocalId} from './admission'
import {trackingStatement} from '../outcomes/tracking.ts'
import type { Actor,Env } from '../../platform/env'
export async function admitInsightPair(env:Env,input:{actor:Actor;conversationId:string;insightId:string;button:string;aiLocalId:string;contactLocalId:string;expectedRevision:number;sessionHash?:string;assistantId?:string;monitoringRequired?:boolean}){
 const {actor,conversationId,insightId,button,aiLocalId,contactLocalId,expectedRevision}=input
 if(actor.role!=='contact'||!actor.contactId||!aiLocalId||!contactLocalId||aiLocalId===contactLocalId||!Number.isSafeInteger(expectedRevision))throw new Error('Invalid insight command')
 // The server-minted prefixes admission.ts reserves (reservedLocalId).
 if([aiLocalId,contactLocalId].some(reservedLocalId))throw Object.assign(new Error('Reserved local id prefix'),{status:400})
 const insight=await env.DB.prepare('SELECT content,buttons FROM context_insights WHERE id=? AND project_id=? AND subject_id=? AND dismissed_at IS NULL').bind(insightId,actor.projectId,actor.contactId).first<{content:string;buttons:string}>();if(!insight)throw new Error('Insight not available')
 const buttons=JSON.parse(insight.buttons) as unknown[],shown=await renderKnowledgeFields(env,actor.projectId,buttons,readerSet([{kind:'contact',id:actor.contactId}]))
 const choice=shown.findIndex(value=>value===button||(value&&typeof value==='object'&&(value as {text?:string}).text===button))
 if(choice<0)throw new Error('Insight button not available')
 const selected=buttons[choice],storedButton=typeof selected==='string'?selected:String((selected as {text:string}).text)
 const aiId=crypto.randomUUID(),contactId=crypto.randomUUID(),now=Date.now()
 const sessionGuard=input.sessionHash?` AND EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=? AND s.actor_id=? AND s.role='contact' AND s.project_id=c.project_id AND s.contact_id=c.contact_id AND s.revoked_at IS NULL AND s.expires_at>?)`:''
 const sessionArgs=input.sessionHash?[input.sessionHash,actor.id,now]:[]
 let aiContent='',contactContent=''
 const admitted=await admitMessage(env,{[atomicMessage]:true,projectId:actor.projectId,conversationId,operatorId:actor.id,messages:[{content:insight.content},{content:storedButton,authorContactId:actor.contactId}],commit:contents=>{
  aiContent=contents[0];contactContent=contents[1]
  return [
 env.DB.prepare(`INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) SELECT ?,c.project_id,c.id,?,'ai','ai',?,c.revision+1,? FROM conversations c JOIN contacts ct ON ct.id=c.contact_id WHERE c.id=? AND c.project_id=? AND c.contact_id=? AND c.revision=? AND c.status_category<>'closed' AND COALESCE(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1 AND EXISTS(SELECT 1 FROM context_insights WHERE id=? AND content=? AND buttons=? AND dismissed_at IS NULL) AND NOT EXISTS(SELECT 1 FROM messages WHERE conversation_id=c.id AND local_id IN (?,?)) AND NOT EXISTS(SELECT 1 FROM message_authorship a WHERE a.source_kind='insight' AND a.source_id=? AND a.kind='visitor') AND NOT EXISTS(SELECT 1 FROM project_settings WHERE project_id=c.project_id AND json_extract(settings_json,'$.deleted_at') IS NOT NULL) ${sessionGuard} ${input.monitoringRequired?`AND EXISTS(SELECT 1 FROM context_subjects s JOIN project_settings ps ON ps.project_id=s.project_id WHERE s.project_id=c.project_id AND s.subject_id=c.contact_id AND s.consent=1 AND s.bot_enabled=1 AND json_extract(ps.settings_json,'$.is_contact_tracking_enabled')=1 AND json_extract(ps.settings_json,'$.proactive_help_enabled')=1)`:''}`).bind(aiId,aiLocalId,aiContent,now,conversationId,actor.projectId,actor.contactId,expectedRevision,insightId,insight.content,insight.buttons,aiLocalId,contactLocalId,insightId,...sessionArgs),
 env.DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) SELECT ?,project_id,conversation_id,?,?,'contact',?,revision+1,? FROM messages WHERE id=?").bind(contactId,contactLocalId,actor.id,contactContent,now,aiId),
 env.DB.prepare("INSERT INTO message_authorship(message_id,project_id,kind,source_kind,source_id,recorded_at) SELECT id,project_id,CASE WHEN actor_role='contact' THEN 'visitor' ELSE 'ai' END,'insight',?,? FROM messages WHERE id IN (?,?)").bind(insightId,now,aiId,contactId),
 trackingStatement(env,conversationId,false,contactId),
 // The visitor's choice is a customer reply: the same lifecycle and attribution as admission.ts.
 env.DB.prepare(`UPDATE conversations SET revision=revision+2,last_message_id=?,resolved_at=NULL,updated_at=?,status_id=CASE WHEN status_category IN ('pending','on_hold','solved') THEN 'open' ELSE status_id END,status_category=CASE WHEN status_category IN ('pending','on_hold','solved') THEN 'open' ELSE status_category END,ticket_actor_id=?,ticket_actor_type='contact',ticket_source='customer_reply' WHERE id=? AND EXISTS(SELECT 1 FROM messages WHERE id=?)`).bind(contactId,now,actor.id,conversationId,contactId),
 ...(input.assistantId?[env.DB.prepare(`INSERT INTO conversation_ai(conversation_id,ai_id) SELECT c.id,? FROM conversations c WHERE c.id=? AND c.assigned_to IS NULL AND EXISTS(SELECT 1 FROM messages WHERE id=?) AND EXISTS(SELECT 1 FROM ai_profiles WHERE id=? AND project_id=c.project_id AND is_enabled=1) ON CONFLICT(conversation_id) DO UPDATE SET ai_id=excluded.ai_id`).bind(input.assistantId,conversationId,contactId,input.assistantId)]:[]),
 env.DB.prepare('INSERT INTO conversation_outbox(project_id,conversation_id,message_id,created_at) SELECT project_id,conversation_id,id,created_at FROM messages WHERE id IN (?,?) ORDER BY revision').bind(aiId,contactId),
 // Read a competing replay in the same transaction; only this pair's first insert may produce effects.
 env.DB.prepare('SELECT * FROM messages WHERE conversation_id=? AND project_id=? AND local_id IN (?,?) ORDER BY revision').bind(conversationId,actor.projectId,aiLocalId,contactLocalId)
 ]}})
 if(!admitted.accepted)return {accepted:false,reason:admitted.reason}
 const messages=admitted.results!.at(-1)!.results as Record<string,unknown>[]
 if(messages.length===2&&messages[0].local_id===aiLocalId&&messages[0].actor_id==='ai'&&messages[0].actor_role==='ai'&&messages[0].content===aiContent&&messages[1].local_id===contactLocalId&&messages[1].content===contactContent&&messages[1].actor_id===actor.id&&messages[1].actor_role==='contact')return {accepted:true,duplicate:messages[0].id!==aiId,messages}
 return {accepted:false,reason:messages.length?'local_id_conflict':'conversation_changed'}
}
