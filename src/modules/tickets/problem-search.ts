import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Actor,AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {ticketAuthority} from './model'
import {problemAvailableSql,problemTicket} from './problem-model'
import {triageData} from '../triage/read'

// A suggestion uses the latest completed prediction under the current taxonomy,
// never an older customer turn, a low-confidence guess or an inaccessible field.
const currentIntent=`EXISTS(SELECT 1 FROM triage_jobs j JOIN triage_settings s ON s.project_id=j.project_id WHERE j.project_id=c.project_id AND j.conversation_id=c.id AND j.state='complete' AND s.enabled=1 AND j.settings_version=s.version AND json_extract(j.predictions_json,'$.intent.confidence')>=s.threshold AND NOT EXISTS(SELECT 1 FROM messages newer WHERE newer.project_id=c.project_id AND newer.conversation_id=c.id AND newer.actor_role='contact' AND newer.revision>j.source_revision) AND NOT EXISTS(SELECT 1 FROM triage_jobs newer WHERE newer.project_id=j.project_id AND newer.conversation_id=j.conversation_id AND newer.source_revision>j.source_revision))`
export const problemSearchRoutes=new Hono<AppEnv>()
problemSearchRoutes.get('/projects/:projectId/ticket-problem-search',async c=>{
 const actor=await scope(c) as Actor,authority={sessionHash:c.get('sessionHash')},guard=await ticketAuthority(c.env,actor,authority),q=(c.req.query('q')||'').trim().toLowerCase(),offset=Number(c.req.query('offset')||0)
 const source=c.req.query('suggest_for')
 if(source!==undefined){
  if(!source||source.length>160||q||!Number.isSafeInteger(offset)||offset<0)throw new HTTPException(400,{message:'Choose one problem and a valid suggestion page'})
  await problemTicket(c.env,actor,source,authority)
  if(!await c.env.DB.prepare('SELECT 1 FROM ticket_problems WHERE project_id=? AND conversation_id=?').bind(actor.projectId,source).first())throw new HTTPException(409,{message:'Mark this ticket as a problem before requesting incident suggestions'})
  const triage=await triageData(c.env,actor,source),intent=triage.values.intent
  const current=await c.env.DB.prepare(`SELECT 1 FROM conversations c WHERE c.project_id=? AND c.id=? AND ${currentIntent}`).bind(actor.projectId,source).first()
  if(!current||triage.state!=='complete'||!intent||!triage.taxonomy.some((t:any)=>t.id===intent&&t.active))return c.json({data:[],has_more:false,offset,message:'No current high-confidence intent is available to your role. Search for an incident instead.'})
  const rows=await c.env.DB.prepare(`SELECT c.id,c.subject,c.channel,c.status_category,ct.name requester_name,ct.email requester_email FROM conversations c JOIN contacts ct ON ct.project_id=c.project_id AND ct.id=c.contact_id JOIN ticket_field_values v ON v.project_id=c.project_id AND v.conversation_id=c.id AND v.field_id='triage_intent' WHERE c.project_id=? AND c.id<>? AND c.status_category NOT IN ('solved','closed') AND json_extract(v.value_json,'$')=? AND ${problemAvailableSql()} AND EXISTS(${guard.sql}) AND ${currentIntent} AND NOT EXISTS(SELECT 1 FROM ticket_problem_incidents linked WHERE linked.project_id=c.project_id AND linked.incident_id=c.id) AND NOT EXISTS(SELECT 1 FROM ticket_problems problem WHERE problem.project_id=c.project_id AND problem.conversation_id=c.id) ORDER BY c.updated_at DESC,c.id LIMIT 51 OFFSET ?`).bind(actor.projectId,source,intent,...guard.params,offset).all<any>()
  return c.json({data:rows.results.slice(0,50),has_more:rows.results.length>50,offset,suggestion:{source:'triage',intent,confirmation_required:true},message:'Same triage intent. Review the ticket and confirm the link; suggestions make no changes.'})
 }
 if(!q||q.length>200||!Number.isSafeInteger(offset)||offset<0)throw new HTTPException(400,{message:'Enter a ticket subject, reference or customer, up to 200 characters'})
 const rows=await c.env.DB.prepare(`SELECT c.id,c.subject,c.channel,c.status_category,ct.name requester_name,ct.email requester_email FROM conversations c JOIN contacts ct ON ct.project_id=c.project_id AND ct.id=c.contact_id WHERE c.project_id=? AND ${problemAvailableSql()} AND EXISTS(${guard.sql}) AND (instr(lower(c.id),?)>0 OR instr(lower(c.subject),?)>0 OR instr(lower(coalesce(ct.name,'')),?)>0 OR instr(lower(coalesce(ct.email,'')),?)>0) ORDER BY c.updated_at DESC,c.id LIMIT 51 OFFSET ?`).bind(actor.projectId,...guard.params,q,q,q,q,offset).all<any>()
 return c.json({data:rows.results.slice(0,50),has_more:rows.results.length>50,offset})
})
