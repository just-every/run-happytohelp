import type {Env} from '../../platform/env'
import {memberAccess} from '../access/gate'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {activeSourceProjectSql} from '../knowledge/public-sources'
import {accessForContact} from '../knowledge/access'
import {getKnowledgeExperience} from '../knowledge/experience'
import {prepareKnowledgeProposal,redactKnowledgeDraft} from '../knowledge/proposals'
/** Only operator-requested assistance receives these internal draft tools. The
 * exact requesting session, current membership and generation remain required. */
async function authority(env:Env,pid:string,gid:string){
 const g=await env.DB.prepare("SELECT actor_json,options_json FROM ai_generations WHERE id=? AND project_id=? AND kind='suggestions' AND state='running'").bind(gid,pid).first<any>()
 if(!g)throw new Error('Current operator generation required')
 const actor=JSON.parse(g.actor_json),hash=JSON.parse(g.options_json).operator_session_hash
 if(actor.role==='contact'||typeof hash!=='string'||!(await memberAccess(env.DB,pid,actor.id))?.permissions.has('knowledge.edit'))throw new Error('Current operator knowledge authority required')
 const guard={sql:`EXISTS(SELECT 1 FROM ai_generations g JOIN sessions s ON s.token_hash=? AND s.actor_id=json_extract(g.actor_json,'$.id') JOIN memberships m ON m.user_id=s.actor_id AND m.project_id=g.project_id LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.id=mr.role_key AND pr.project_id=m.project_id WHERE g.id=? AND g.project_id=? AND g.kind='suggestions' AND g.state='running' AND s.role<>'contact' AND s.revoked_at IS NULL AND s.expires_at>? AND (s.project_id IS NULL OR s.project_id=g.project_id) AND ${activeSourceProjectSql('g.project_id')} AND (m.role='owner' OR (mr.role_key IS NULL AND m.role IN ('admin','operator')) OR EXISTS(SELECT 1 FROM json_each(pr.permissions_json) WHERE value='knowledge.edit')))`,args:[hash,gid,pid,Date.now()]}
 if(!await env.DB.prepare('SELECT 1 WHERE '+guard.sql).bind(...guard.args).first())throw new Error('Operator draft authority changed')
 return guard
}
const text={type:'string'}
export async function operatorKnowledgeTools(env:Env,pid:string,gid:string){
 try{await authority(env,pid,gid)}catch(error){if(/^(Error: )?(Current operator|Operator draft authority)/.test(String(error)))return [];throw error}
 const source=async(resolutionId:string)=>{
  const row=await env.DB.prepare(`SELECT r.conversation_id conversationId,r.cycle_start_revision startRevision,r.resolved_revision endRevision,c.contact_id contactId,ct.name FROM conversation_resolutions r JOIN conversations c ON c.id=r.conversation_id AND c.project_id=r.project_id JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id WHERE r.id=? AND r.project_id=? AND c.brand_id=c.project_id AND r.reopened_at IS NULL AND c.resolved_at IS NOT NULL AND ${contactAvailableSql()} AND EXISTS(SELECT 1 FROM csat_responses f WHERE f.resolution_id=r.id AND (f.scale='thumbs' AND f.score=1 OR f.scale='five' AND f.score>=4))`).bind(resolutionId,pid).first<any>()
  if(!row)throw new Error('A currently resolved native case with positive customer feedback is required')
  return row
 }
 return [
 {allowSummary:false,definition:{type:'function',function:{name:'read_verified_resolution',description:'Inspect a specific verified resolution chosen by the operator. Return masked human/customer messages and permitted private destination collections, never private notes. This does not authorize publication or transfer into historical model evaluation.',parameters:{type:'object',properties:{resolutionId:text},required:['resolutionId'],additionalProperties:false}}},function:async(resolutionId:string)=>{
  await authority(env,pid,gid);const row=await source(resolutionId),access=await accessForContact(env,pid,row.contactId),domain=access?.email?.split('@')[1]
  const messages=await env.DB.prepare("SELECT id,content,actor_role role FROM messages WHERE conversation_id=? AND project_id=? AND revision>=? AND revision<=? AND actor_role IN ('contact','owner','admin','operator') AND erased_at IS NULL ORDER BY revision LIMIT 51").bind(row.conversationId,pid,row.startRevision,row.endRevision).all<any>()
  if(messages.results.length>50)throw new Error('Resolution exceeds the bounded draft preview')
  const categories=domain?(await env.DB.prepare("SELECT id,name FROM knowledge_categories WHERE project_id=? AND audience='domains' AND json_array_length(allowed_domains)=1 AND json_extract(allowed_domains,'$[0]')=?").bind(pid,domain).all()).results:[]
  await authority(env,pid,gid)
  return {resolutionId,conversationId:row.conversationId,locale:(await getKnowledgeExperience(env,pid)).defaultLocale,messages:messages.results.map(m=>({id:m.id,role:m.role,content:redactKnowledgeDraft(m.content,row.name)})),privateDestinationCollections:categories,publicationRequiresNamedEditor:true}
 }},
 {allowSummary:false,definition:{type:'function',function:{name:'propose_knowledge_change',description:'Prepare one masked private article draft from an exact message in a verified resolution. The server copies and masks its source quote; this never publishes or sends. A named editor must review scope, personal data and the proposed text.',parameters:{type:'object',properties:{resolutionId:text,messageId:text,categoryId:text,title:text},required:['resolutionId','messageId','categoryId','title'],additionalProperties:false}}},function:async(resolutionId:string,messageId:string,categoryId:string,title:string)=>{
  const guard=await authority(env,pid,gid),row=await source(resolutionId),message=await env.DB.prepare('SELECT content FROM messages WHERE id=? AND conversation_id=? AND project_id=? AND revision>=? AND revision<=? AND erased_at IS NULL').bind(messageId,row.conversationId,pid,row.startRevision,row.endRevision).first<{content:string}>()
  if(!message)throw new Error('Exact source message required')
  return prepareKnowledgeProposal(env,pid,{conversationId:row.conversationId,resolutionId,messageId,categoryId,title,quote:message.content},guard)
 }}]
}
