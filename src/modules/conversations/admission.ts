import {knowledgeWords} from '../knowledge/words'
import {referenceAdmissionPolicy} from '../knowledge/reference-policy'
import {referenceIds,tokenPattern} from '../knowledge/reference-store'
import {literal,readerSet} from '../knowledge/door'
import {canonicaliseKnowledge} from '../knowledge/canonicaliser'
import {createBlocks,referencesAdmittedSql,referenceVisibility} from '../knowledge/reference-store'
import {articleSourceIdentities} from '../knowledge/source-identity'
import {currentTicketReaders,combineReaders} from '../knowledge/readers'
import {companyPortalReply,portalTicketScope} from '../portal/company-visibility'
import {workflowNow,workflowEnvironment} from '../workflows/clock'
import {followupId,createFollowupStatement,carryFollowupStatements} from '../workflows/followups'
import {scheduledAdmission,type ScheduledAdmission} from '../workflows/schedule-authority'
import {assignmentHistoryStatement} from '../outcomes/assignment-history.ts'
import {inboundAuthority,provenAddressSql,type InboundAuthority} from '../integrations/inbound-authority.ts'
import {contactAvailableSql} from './contact-privacy.ts'
import {tokenGuard,type TokenAuthority} from '../../platform/integration-authority.ts'
import {authoringSource,authorshipStatement,type Authoring} from '../outcomes/provenance.ts'
import {trackingStatement} from '../outcomes/tracking.ts'
import {requiredToSolve,solving} from '../tickets/fields.ts'
import {memberAccess} from '../access/gate.ts'
import {resolvePublicCitations,activeSourceProjectSql,type PublicReference} from '../knowledge/public-sources.ts'
import type { Actor,Env } from '../../platform/env'
import {assertPublicReplyPlaceholders} from '../macros/placeholders'
import {writableConversationSql} from '../conversation-actions/merge-read'
/** Local ids the server mints: `email:` identifies an inbound email claim, `erased:`
 * replaces a client-supplied id when its contact is erased (contact-erasure/statements.ts)
 * and `away:` is the workspace's away reply (management/away-reply.ts). Clients may use none. */
export const reservedLocalId=(localId:unknown)=>typeof localId==='string'&&/^(?:email|erased|away|schedule|problem):/.test(localId)
/** An internal authority may add a transaction predicate; JSON callers cannot mint this symbol. */
export const messageAuthority=Symbol('messageAuthority')
export const messageCommit=Symbol('messageCommit')
/** Internal atomic receipt updates; never populated from request JSON. */
export const messageCommitStatements=Symbol('messageCommitStatements')
export const sharedChannelParticipant=Symbol('sharedChannelParticipant')
export interface MessageInput {[sharedChannelParticipant]?:true;[messageCommitStatements]?:(messageId:string)=>D1PreparedStatement[];[messageCommit]?:(messageId:string,conversationId:string,now:number)=>D1PreparedStatement[];[companyPortalReply]?:true;[messageAuthority]?:{sql:string;args:unknown[]};requireAvailableRequester?:true;[scheduledAdmission]?:ScheduledAdmission;[inboundAuthority]?:InboundAuthority;projectId:string;conversationId:string;actor:Actor;localId:string;content:string;expectedRevision:number;expectedLastMessageId?:string|null;mediaIds?:string[];resolve?:boolean;generationId?:string;citations?:PublicReference[];authoring?:Authoring;sessionHash?:string;tokenAuthority?:TokenAuthority}
export interface MessageResult {accepted:boolean;duplicate?:boolean;message?:any;reason?:string;content?:string;blockedReferences?:unknown[];followupConversationId?:string}
export const atomicMessage=Symbol('atomicMessage')
export interface AtomicMessageInput {
 [atomicMessage]:true;projectId:string;conversationId:string;operatorId:string;newRequesterId?:string;
 messages:{content:string;authorContactId?:string}[];
 commit:(contents:string[])=>D1PreparedStatement[]
}
export async function admitMessage(env:Env,input:AtomicMessageInput):Promise<MessageResult&{results?:D1Result[]}>;
export async function admitMessage(env:Env,input:MessageInput):Promise<MessageResult>;
export async function admitMessage(env:Env,input:MessageInput|AtomicMessageInput):Promise<MessageResult&{results?:D1Result[]}>{
 if(atomicMessage in input){
  const contents=await Promise.all(input.messages.map(message=>canonicaliseKnowledge(env,input.projectId,message.content,message.authorContactId))),readers=input.newRequesterId?combineReaders(currentTicketReaders(input.projectId,input.conversationId,{}),readerSet([{kind:'contact',id:input.newRequesterId}])):currentTicketReaders(input.projectId,input.conversationId,{}),knowledge=referenceAdmissionPolicy(referenceIds(contents.join('\n')),literal(input.projectId),readers),id=crypto.randomUUID()
  const guard=env.DB.prepare(`${knowledge.prefix}INSERT INTO knowledge_write_guards(id,valid) SELECT ?,CASE WHEN ${knowledge.sql} AND ${contents.some(content=>knowledgeWords(content.replace(tokenPattern,'')).length>=12)?'NOT EXISTS(SELECT 1 FROM knowledge_index_dirty)':'1=1'} THEN 1 ELSE 0 END`).bind(...knowledge.params,id)
  try{const result=await env.DB.batch([guard,...input.commit(contents),env.DB.prepare('DELETE FROM knowledge_write_guards WHERE id=?').bind(id)]);return {accepted:true,results:result.slice(1,-1)}}catch(error){
   if(await env.DB.prepare(`${knowledge.prefix}SELECT 1 WHERE ${knowledge.sql}`).bind(...knowledge.params).first())throw error
   return {accepted:false,reason:'knowledge_access_denied'}
  }
 }

 const {projectId,conversationId,actor,localId,expectedRevision}=input,email=input[inboundAuthority]
 let content=input.content
 if(actor.projectId!==projectId)throw new Error('Project access denied')
 if(actor.role!=='contact')assertPublicReplyPlaceholders(content)
 if(!localId||localId.length>200||localId.startsWith('erased:')||typeof content!=='string'||content.length>100000||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new Error('Invalid message command')
 if(input.citations?.length&&!input.generationId)throw new Error('Only finalized AI messages may cite knowledge')
 const refs=input.citations??[]
 if(!Array.isArray(refs)||refs.length>10||refs.some(r=>!r||typeof r.id!=='string'||typeof r.sourceVersion!=='string'))throw new Error('Invalid public citations')
 const mediaIds=[...new Set(input.mediaIds||[])];if(mediaIds.length>20||(!content.trim()&&!mediaIds.length))throw new Error('Invalid message content')
 const intentHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({content,mediaIds:[...mediaIds].sort(),resolve:!!input.resolve,expectedRevision,expectedLastMessageId:input.expectedLastMessageId,generationId:input.generationId,...(refs.length?{citations:refs.map(r=>({id:r.id,sourceVersion:r.sourceVersion}))}: {})}))))).map(x=>x.toString(16).padStart(2,'0')).join('')
 const replayGuard=input.tokenAuthority?tokenGuard(input.tokenAuthority,projectId,input.tokenAuthority.scope==='messages:append'?'messages:append':'messages:write'):null
 const sharedSender=input[sharedChannelParticipant]===true&&actor.role==='contact'&&!!input[messageAuthority]
 const companyReply=input[companyPortalReply]===true&&actor.role==='contact'&&!!input.sessionHash&&!!input[messageAuthority]
 const authority=input[messageAuthority]
 const replayPredicate=(replayGuard?`AND erased_at IS NULL AND EXISTS(${replayGuard.sql}) AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=messages.conversation_id AND c.project_id=messages.project_id AND ${contactAvailableSql()})`:'')+(authority?` AND (${authority.sql})`:'')
 const replayArgs=[...(replayGuard?.params||[]),...(authority?.args||[])]
 const checkMembership=!input.tokenAuthority&&!input.generationId&&actor.role!=='contact'
 // These observations are independent. Keep denial/replay precedence below,
 // and keep every live-authority and frontier predicate in the write itself.
 const observations=await env.DB.batch<any>([
  env.DB.prepare('SELECT c.contact_id,c.resolved_at,c.assigned_to,c.group_id,c.status_id,c.status_category,c.ticket_version,(SELECT MAX(ordinal) FROM conversation_resolutions WHERE conversation_id=c.id) ordinal FROM conversations c WHERE c.id=? AND c.project_id=?').bind(conversationId,projectId),
  env.DB.prepare(`SELECT * FROM messages WHERE conversation_id=? AND project_id=? AND local_id=? ${replayPredicate}`).bind(conversationId,projectId,localId,...replayArgs),
  ...(checkMembership?[env.DB.prepare('SELECT 1 FROM memberships WHERE project_id=? AND user_id=? AND role=?').bind(projectId,actor.id,actor.role)]:[]),
  ...(input.generationId?[env.DB.prepare('SELECT ai_id FROM ai_generations WHERE id=? AND project_id=? AND conversation_id=?').bind(input.generationId,projectId,conversationId)]:[])
 ])
 const scope=observations[0].results[0]
 if(!scope||(!input.generationId&&actor.role==='contact'&&!email&&!companyReply&&!sharedSender&&scope.contact_id!==(actor.contactId||actor.id)))return {accepted:false,reason:'conversation_access_denied'}
 if(checkMembership&&!observations[2].results[0])return {accepted:false,reason:'conversation_access_denied'}
 const generation=input.generationId?observations[2].results[0]:null
 if(input.generationId&&!generation)return {accepted:false,reason:'generation_not_found'}
 const writerId=generation?.ai_id||actor.id,existing=observations[1].results[0]
 async function replayAdmitted(message:any,target=conversationId):Promise<MessageResult>{
  const readers=currentTicketReaders(projectId,target,{contacts:email?.cc,localId}),knowledge=referenceAdmissionPolicy(referenceIds(message.content),literal(projectId),readers)
  if(!await env.DB.prepare(`${knowledge.prefix}SELECT 1 WHERE ${knowledge.sql}`).bind(...knowledge.params).first())return {accepted:false,reason:'knowledge_access_denied',content:message.content,blockedReferences:(await referenceVisibility(env,projectId,message.content,actor.id,readers)).filter(ref=>ref.recipients.some(recipient=>!recipient.visible))}
  return {accepted:true,duplicate:true,message,...(target!==conversationId?{followupConversationId:target}:{})}
 }

 if(existing){if(existing.actor_id!==writerId||existing.intent_hash!==intentHash) return {accepted:false,reason:'local_id_conflict'};return replayAdmitted(existing)}
 const followup=scope.status_category==='closed'&&actor.role==='contact'&&!input.generationId
 if(scope.status_category==='closed'&&!followup)return {accepted:false,reason:'ticket_closed_followup_required'}
 const targetId=followup?await followupId(projectId,conversationId,actor.id,localId):conversationId
 if(followup){const replay=await env.DB.prepare('SELECT * FROM messages WHERE project_id=? AND conversation_id=? AND local_id=?').bind(projectId,targetId,localId).first<any>();if(replay){if(replay.actor_id!==writerId||replay.intent_hash!==intentHash)return {accepted:false,reason:'local_id_conflict'};return replayAdmitted(replay,targetId)}}
 const autoAssign=actor.role!=='contact'&&!input.generationId&&!input.tokenAuthority&&(!scope.group_id||!!await env.DB.prepare('SELECT 1 FROM ticket_group_members WHERE project_id=? AND group_id=? AND user_id=?').bind(projectId,scope.group_id,actor.id).first())
 const authorship=await authoringSource(env,actor,conversationId,input.authoring,input.generationId)
 const citations=refs.length?await resolvePublicCitations(env,projectId,input.generationId!,refs,currentTicketReaders(projectId,conversationId,{contacts:email?.cc,localId})):[]
 // A generation may carry its initiating contact actor; only genuine customer
 // speech receives the own-word exception, never an assistant's final answer.
 const authorContactId=!input.generationId&&actor.role==='contact'?actor.contactId||actor.id:undefined
 content=await canonicaliseKnowledge(env,projectId,content,authorContactId,false,input.generationId)
 // Keep copied-source checks alongside the generation's retrieved-source set.
 const copiedReferences=referenceIds(content)
 if(input.generationId){const sources=await env.DB.prepare('SELECT source_id FROM ai_generation_sources WHERE project_id=? AND generation_id=?').bind(projectId,input.generationId).all<{source_id:string}>();if(sources.results.length)[content]=await createBlocks(env,projectId,[{kind:'answer',text:content,sources:sources.results.map(row=>row.source_id),generationId:input.generationId}])}
 for(const citation of citations){const [token]=await createBlocks(env,projectId,[{kind:'link',text:`[${citation.title}](${citation.url})`,title:citation.title,url:citation.url,sources:[citation.id],sourceIdentities:articleSourceIdentities(projectId,[citation])}]);content+='\n\n'+token}
 const citationRefs=await createBlocks(env,projectId,citations.map(citation=>({kind:'text' as const,text:JSON.stringify(citation),title:citation.title,url:citation.url,sources:[citation.id],sourceIdentities:articleSourceIdentities(projectId,[citation])})))
 const citationJson=JSON.stringify(citationRefs.map(token=>({knowledge_citation:token})))
 const raw=email?await canonicaliseKnowledge(env,projectId,email.raw,authorContactId):undefined
 env=await workflowEnvironment(env)
 const messageId=crypto.randomUUID(),now=workflowNow(env);const predicates=[writableConversationSql('c'),'c.id=?','c.project_id=?','c.revision=?','c.contact_id=?','c.ticket_version=?',followup?"c.status_category='closed'":"c.status_category<>'closed'"];const args:unknown[]=[conversationId,projectId,expectedRevision,scope.contact_id,scope.ticket_version]
 if(input.requireAvailableRequester===true)predicates.push(contactAvailableSql())
 if(autoAssign&&scope.group_id){predicates.push('EXISTS(SELECT 1 FROM ticket_group_members WHERE project_id=c.project_id AND group_id=c.group_id AND user_id=?)');args.push(actor.id)}
 if(input.resolve&&!input.generationId){predicates.push('c.resolved_at IS ?','(SELECT MAX(ordinal) FROM conversation_resolutions WHERE conversation_id=c.id) IS ?');args.push(scope.resolved_at,scope.ordinal)}
 // Reply-and-resolve is a transition into solved: the same required-to-solve fields as every ticket door (tickets/mutate-validation.ts).
 if(input.resolve&&actor.role!=='contact'&&!input.generationId&&solving(scope.status_category,'solved')){
  const [definitions,stored]=await env.DB.batch<any>([env.DB.prepare('SELECT * FROM ticket_fields WHERE project_id=?').bind(projectId),env.DB.prepare('SELECT field_id,value_json FROM ticket_field_values WHERE project_id=? AND conversation_id=?').bind(projectId,conversationId)])
  for(const field of requiredToSolve(definitions.results,Object.fromEntries(stored.results.map((v:any)=>[v.field_id,JSON.parse(v.value_json)])),{},input.tokenAuthority?null:await memberAccess(env.DB,projectId,actor.id))){predicates.push('EXISTS(SELECT 1 FROM ticket_field_values WHERE project_id=c.project_id AND conversation_id=c.id AND field_id=?)');args.push(field)}
 }
 if(input.tokenAuthority){const guard=tokenGuard(input.tokenAuthority,projectId,input.tokenAuthority.scope==='messages:append'?'messages:append':'messages:write');predicates.push(`EXISTS(${guard.sql})`,contactAvailableSql());args.push(...guard.params)}else if(input.generationId){predicates.push(`c.assigned_to IS NULL AND ${activeSourceProjectSql('c.project_id')}`)}else if(companyReply){const visible=portalTicketScope({actor,sessionHash:input.sessionHash!});predicates.push(visible.sql);args.push(...visible.args)}else if(sharedSender){predicates.push("EXISTS(SELECT 1 FROM contacts ct JOIN conversation_participants cp ON cp.contact_id=ct.id AND cp.conversation_id=c.id WHERE ct.id=? AND ct.project_id=c.project_id AND coalesce(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND coalesce(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND coalesce(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1)");args.push(actor.id)}else if(actor.role==='contact'&&!email){predicates.push("c.contact_id=? AND EXISTS(SELECT 1 FROM contacts contact WHERE contact.id=c.contact_id AND COALESCE(json_extract(contact.metadata_json,'$.is_blocked'),0)!=1)");args.push(actor.contactId||actor.id)}else if(actor.role!=='contact'){predicates.push('EXISTS(SELECT 1 FROM memberships WHERE project_id=c.project_id AND user_id=? AND role=?)');args.push(actor.id,actor.role)}
 if(email){
  predicates.push(`EXISTS(SELECT 1 FROM inbound_emails receipt WHERE receipt.id=? AND receipt.project_id=c.project_id AND receipt.conversation_id=c.id AND receipt.claim_token=? AND receipt.state='processing' AND (EXISTS(SELECT 1 FROM email_settings mailbox WHERE mailbox.project_id=receipt.project_id AND mailbox.is_enabled=1 AND ? IS NULL) OR EXISTS(SELECT 1 FROM mailbox_connections mailbox JOIN mailbox_addresses address ON address.mailbox_id=mailbox.id AND address.project_id=mailbox.project_id WHERE mailbox.id=? AND mailbox.project_id=receipt.project_id AND mailbox.status='connected' AND address.address=?)))`,activeSourceProjectSql('c.project_id'),contactAvailableSql())
  args.push(email.receiptId,email.claimToken,email.mailboxId??null,email.mailboxId??null,email.mailboxAddress??null)
  if(actor.role==='contact'){
   // A grant continues its own ticket or its explicitly linked Closed follow-up; current membership is rechecked.
   predicates.push(`EXISTS(SELECT 1 FROM contacts sender WHERE sender.id=? AND sender.project_id=c.project_id AND (lower(sender.email)=? AND ${provenAddressSql('sender')} OR EXISTS(SELECT 1 FROM email_reply_grants issued WHERE issued.token_hash=? AND issued.project_id=c.project_id AND (issued.conversation_id=c.id OR EXISTS(SELECT 1 FROM email_followup_links link JOIN conversations parent ON parent.id=link.parent_id AND parent.project_id=link.project_id WHERE link.project_id=c.project_id AND link.conversation_id=c.id AND parent.id=issued.conversation_id AND (parent.contact_id=sender.id OR EXISTS(SELECT 1 FROM conversation_participants current WHERE current.conversation_id=parent.id AND current.contact_id=sender.id)))) AND lower(issued.recipient)=? AND (lower(sender.email)=lower(issued.recipient) OR lower(json_extract(sender.metadata_json,'$.provided_email'))=lower(issued.recipient)))) AND coalesce(json_extract(sender.metadata_json,'$.is_blocked'),0)!=1 AND coalesce(json_extract(sender.metadata_json,'$.is_deleted'),0)!=1 AND coalesce(json_extract(sender.metadata_json,'$.is_erased'),0)!=1 AND coalesce(json_extract(sender.metadata_json,'$.is_erasing'),0)!=1 AND (c.contact_id=sender.id OR EXISTS(SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id=c.id AND cp.contact_id=sender.id)))`)
   args.push(actor.id,email.sender,email.grant??null,email.sender)
  }else{
   predicates.push('EXISTS(SELECT 1 FROM memberships live JOIN users sender ON sender.id=live.user_id WHERE live.project_id=c.project_id AND live.user_id=? AND live.role=? AND lower(sender.email)=?)')
   args.push(actor.id,actor.role,email.sender)
  }
 }
 if(input[scheduledAdmission]){const guard=input[scheduledAdmission]!;predicates.push(guard.sql);args.push(...guard.params)}
 if(input.sessionHash){predicates.push(activeSourceProjectSql('c.project_id'));predicates.push("EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=? AND s.actor_id=? AND s.revoked_at IS NULL AND s.expires_at>? AND (s.role='contact' AND s.project_id=c.project_id AND s.contact_id="+(companyReply?'?':'c.contact_id')+" OR s.role<>'contact' AND (s.project_id IS NULL AND s.role='operator' OR s.project_id=c.project_id AND EXISTS(SELECT 1 FROM memberships live WHERE live.project_id=s.project_id AND live.user_id=s.actor_id AND live.role=s.role))))");args.push(input.sessionHash,actor.id,Date.now(),...(companyReply?[actor.contactId||actor.id]:[]))}
 if(authority){predicates.push(`(${authority.sql})`);args.push(...authority.args)}
 if(input.expectedLastMessageId!==undefined){predicates.push('c.last_message_id IS ?');args.push(input.expectedLastMessageId)}
 if(mediaIds.length){predicates.push(`(SELECT COUNT(*) FROM media WHERE id IN (${mediaIds.map(()=>'?').join(',')}) AND project_id=c.project_id AND conversation_id=c.id AND message_id IS NULL AND NOT EXISTS(SELECT 1 FROM conversation_note_media nm WHERE nm.media_id=media.id) AND uploaded_by=?)=?`);args.push(...mediaIds,actor.id,mediaIds.length)}
 if(input.generationId){predicates.push("EXISTS(SELECT 1 FROM ai_generations g WHERE g.id=? AND g.project_id=c.project_id AND g.conversation_id=c.id AND g.state='running' AND g.source_revision=c.revision AND (SELECT revision FROM context_subjects WHERE project_id=c.project_id AND subject_id=c.contact_id)=g.source_context_revision AND c.resolved_at IS NULL AND EXISTS(SELECT 1 FROM conversation_ai ca JOIN ai_profiles a ON a.id=ca.ai_id WHERE ca.conversation_id=c.id AND a.id=g.ai_id AND a.project_id=c.project_id AND a.is_enabled=1 AND a.model=json_extract(g.ai_profile_json,'$.model') AND a.prompt=json_extract(g.ai_profile_json,'$.prompt')))");args.push(input.generationId)}
 if(authorship.guard){predicates.push(authorship.guard.sql);args.push(...authorship.guard.params)}
 const indexedContent=knowledgeWords(content.replace(tokenPattern,'')).length>=12
 const knowledge=referenceAdmissionPolicy([...new Set([...copiedReferences,...referenceIds(content)])],literal(projectId),currentTicketReaders(projectId,conversationId,{contacts:email?.cc,localId}))
 predicates.push(knowledge.sql,...(indexedContent?[`NOT EXISTS(SELECT 1 FROM knowledge_index_dirty)`]:[]))
 const citationColumns=',citations_json'+(email?',content_raw':''),citationValues=',?'+(email?',?':'')
 const nextCategory=followup?'open':actor.role!=='contact'&&input.resolve?'solved':actor.role==='contact'?['pending','on_hold','solved'].includes(scope.status_category)?'open':scope.status_category:['solved','new'].includes(scope.status_category)?'open':scope.status_category
 const nextStatusId=!followup&&nextCategory===scope.status_category?scope.status_id:nextCategory
 const statements=[...(followup?[createFollowupStatement(env,{id:targetId,now,actorId:actor.id,predicates,args,prefix:knowledge.prefix,prefixArgs:knowledge.params,...(email?{email:{receiptId:email.receiptId,claimToken:email.claimToken}}:{})})]:[]),env.DB.prepare(`${knowledge.prefix}INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at,intent_hash${citationColumns}) SELECT ?,c.project_id,?,?,?,?,?,${followup?'1':'c.revision+1'},?,?${citationValues} FROM conversations c WHERE ${predicates.join(' AND ')} AND NOT EXISTS(SELECT 1 FROM messages WHERE conversation_id=? AND local_id=?)`).bind(...knowledge.params,messageId,targetId,localId,writerId,input.generationId?'ai':actor.role,content,now,intentHash,citationJson,...(email?[raw]:[]),...args,targetId,localId),authorshipStatement(env,messageId,authorship,now),...(input[messageCommit]?.(messageId,targetId,now)??[]),trackingStatement(env,targetId,followup,messageId),env.DB.prepare(`UPDATE conversations SET revision=revision+1,last_message_id=?,updated_at=?,resolved_at=?,status_id=?,status_category=?,ticket_actor_id=?,ticket_actor_type=?,ticket_source=?,subject=CASE WHEN revision=0 AND subject='' THEN COALESCE((SELECT substr(json_extract(evidence_json,'$.subject'),1,500) FROM inbound_emails WHERE id=? AND claim_token=? AND conversation_id=conversations.id),?) ELSE subject END,channel=CASE WHEN revision=0 AND ? THEN 'email' ELSE channel END,assigned_to=CASE WHEN ? THEN ? ELSE assigned_to END WHERE id=? AND EXISTS(SELECT 1 FROM messages WHERE id=?)`).bind(messageId,now,actor.role!=='contact'&&input.resolve?now:null,nextStatusId,nextCategory,writerId,actor.role==='contact'?'contact':input.tokenAuthority?'api':input.generationId?'system':'user',email?'email':input[scheduledAdmission]?'schedule':actor.role==='contact'?'customer_reply':input.tokenAuthority?'api':input.generationId?'system':'dashboard',email?.receiptId??null,email?.claimToken??null,content.split(/\r?\n/,1)[0].trim().slice(0,500),email?1:0,autoAssign?1:0,actor.id,targetId,messageId),env.DB.prepare('INSERT INTO conversation_outbox(project_id,conversation_id,message_id,created_at) SELECT project_id,conversation_id,id,created_at FROM messages WHERE id=?').bind(messageId)]
 if(followup){statements.push(...carryFollowupStatements(env,{id:targetId,originalId:conversationId,messageId,actorId:actor.id,localId,now}));if(email)statements.push(env.DB.prepare('UPDATE inbound_emails SET conversation_id=? WHERE id=? AND claim_token=? AND EXISTS(SELECT 1 FROM messages WHERE id=?)').bind(targetId,email.receiptId,email.claimToken,messageId),env.DB.prepare('INSERT OR IGNORE INTO email_followup_links(project_id,parent_id,conversation_id,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM messages WHERE id=?)').bind(projectId,conversationId,targetId,now,messageId))}
 if(email?.cc.length)for(const contactId of email.cc)statements.push(env.DB.prepare(`INSERT OR IGNORE INTO conversation_participants(id,conversation_id,contact_id,created_at,joined_via) SELECT ?,m.conversation_id,ct.id,?,'cc_header' FROM messages m JOIN contacts ct ON ct.project_id=m.project_id WHERE m.id=? AND ct.id=? AND coalesce(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1 AND coalesce(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND coalesce(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1`).bind(crypto.randomUUID(),now,messageId,contactId))
 // A participant writing with authenticated mail or its issued reply address proves its own address.
 if(email&&actor.role==='contact'&&(email.authenticated||email.grant))statements.push(env.DB.prepare("UPDATE conversation_participants SET joined_via='self' WHERE conversation_id=? AND contact_id=? AND joined_via='cc_header' AND EXISTS(SELECT 1 FROM messages WHERE id=?)").bind(targetId,actor.id,messageId))
 if(autoAssign&&scope.assigned_to!==actor.id)statements.push(assignmentHistoryStatement(env,{id:`message:${messageId}`,conversationId:targetId,actorId:actor.id,agentId:actor.id,createdAt:now},'EXISTS(SELECT 1 FROM messages WHERE id=?)',[messageId]))
 if(actor.role!=='contact'&&!input.generationId)statements.push(env.DB.prepare("UPDATE ai_generations SET state='cancelled',updated_at=? WHERE conversation_id=? AND project_id=? AND state IN ('queued','running') AND EXISTS(SELECT 1 FROM messages WHERE id=?)").bind(new Date(now).toISOString(),conversationId,projectId,messageId))
 if(mediaIds.length)statements.push(env.DB.prepare(`UPDATE media SET message_id=?,conversation_id=? WHERE id IN (${mediaIds.map(()=>'?').join(',')}) AND EXISTS(SELECT 1 FROM messages WHERE id=?)`).bind(messageId,targetId,...mediaIds,messageId))
 if(input.generationId)statements.push(env.DB.prepare("UPDATE ai_generations SET state='completed' WHERE id=? AND EXISTS(SELECT 1 FROM messages WHERE id=?)").bind(input.generationId,messageId))
 // Read the admitted row and any competing same-command replay in the same
 // transaction. This preserves their authoritative predicates and avoids a
 // separate D1 round trip after the guarded write.
 if(actor.role!=='contact')statements.push(env.DB.prepare('DELETE FROM macro_drafts WHERE project_id=? AND conversation_id=? AND actor_id=? AND EXISTS(SELECT 1 FROM messages WHERE id=?)').bind(projectId,conversationId,actor.id,messageId))
 if(input[messageCommitStatements])statements.push(...input[messageCommitStatements]!(messageId))
 const committedIndex=statements.length
 statements.push(
  env.DB.prepare(`SELECT * FROM messages WHERE id=? ${replayPredicate}`).bind(messageId,...replayArgs),
  env.DB.prepare(`SELECT * FROM messages WHERE conversation_id=? AND project_id=? AND local_id=? ${replayPredicate}`).bind(conversationId,projectId,localId,...replayArgs)
 )
 const committed=await env.DB.batch<any>(statements),message=committed[committedIndex].results[0]
 if(!message){const duplicate=committed[committedIndex+1].results[0];if(duplicate&&duplicate.actor_id===writerId&&duplicate.intent_hash===intentHash)return replayAdmitted(duplicate);const visible=await env.DB.prepare(`${knowledge.prefix}SELECT 1 WHERE ${knowledge.sql}`).bind(...knowledge.params).first();if(!visible){const references=await referenceVisibility(env,projectId,content,actor.id,currentTicketReaders(projectId,conversationId,{contacts:email?.cc,localId}));return {accepted:false,reason:'knowledge_access_denied',content,blockedReferences:references.filter(ref=>ref.recipients.some(recipient=>!recipient.visible))}}return {accepted:false,reason:'conversation_changed_or_admission_denied'}}
 return {accepted:true,duplicate:false,message,...(followup?{followupConversationId:targetId}:{})}
}
