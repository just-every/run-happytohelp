import {conversationHasMessages} from '../management/inbox-visible'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {invalid,object,availableTicketSql} from '../tickets/model'
import {workflowScope} from './routes-rules'
import {workflowNow} from './clock'
import {decisionData} from './routing'
import {commitWorkflowSettings} from './rule-admin'
import {definitionVisible,workflowVisibleFields} from './rule-access'
export const workflowRoutingRoutes=new Hono<AppEnv>()
const path='/projects/:projectId/routing-operators'
async function operatorRows(c:any,projectId:string){const rows=await c.env.DB.prepare(`SELECT m.user_id,u.name,u.email,coalesce(o.available,0) available,coalesce(o.capacity,10) capacity,coalesce(o.skills_json,'[]') skills_json,coalesce(o.updated_at,0) updated_at,(SELECT count(*) FROM conversations c WHERE c.project_id=m.project_id AND c.assigned_to=m.user_id AND c.status_category NOT IN ('solved','closed') AND ${conversationHasMessages()}) workload FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN routing_operators o ON o.project_id=m.project_id AND o.user_id=m.user_id WHERE m.project_id=? ORDER BY u.name,m.user_id`).bind(projectId).all();return rows.results.map(({skills_json,...row}:any)=>({...row,available:!!row.available,active:1,skills:JSON.parse(skills_json)}))}
workflowRoutingRoutes.get(path,async c=>{const actor=await workflowScope(c);return c.json({operators:await operatorRows(c,actor.projectId)})})
workflowRoutingRoutes.put(path,async c=>{const actor=await workflowScope(c,true),b=object(await c.req.json());if(!Array.isArray(b.operators)||b.operators.length>200)invalid('Provide up to 200 operators');const seen=new Set(),now=workflowNow(c.env),definitions:any[]=[]
 for(const raw of b.operators){const o=object(raw);if(typeof o.user_id!=='string'||!o.user_id||seen.has(o.user_id)||typeof o.available!=='boolean'||!Number.isSafeInteger(o.capacity)||o.capacity<0||o.capacity>10000||!Array.isArray(o.skills)||o.skills.length>30||o.skills.some((s:unknown)=>typeof s!=='string'||!s||s.length>80))invalid('Invalid operator availability, capacity or skills');seen.add(o.user_id);if(!await c.env.DB.prepare('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?').bind(actor.projectId,o.user_id).first())invalid('Operator must be a current workspace member');definitions.push(o)}
 await commitWorkflowSettings(c,actor,'workflow.routing.operators',actor.projectId,(accepted,args)=>definitions.map(o=>c.env.DB.prepare(`INSERT INTO routing_operators(project_id,user_id,available,capacity,skills_json,updated_at) SELECT ?,?,?,?,?,? WHERE ${accepted} ON CONFLICT(project_id,user_id) DO UPDATE SET available=excluded.available,capacity=excluded.capacity,skills_json=excluded.skills_json,updated_at=max(routing_operators.updated_at+1,excluded.updated_at)`).bind(actor.projectId,o.user_id,o.available?1:0,o.capacity,JSON.stringify([...new Set(o.skills)]),now,...args)),{sql:"NOT EXISTS(SELECT 1 FROM json_each(?) requested WHERE NOT EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=? AND m.user_id=json_extract(requested.value,'$.user_id')))",params:[JSON.stringify(definitions),actor.projectId]})
 return c.json({operators:await operatorRows(c,actor.projectId)})
})
workflowRoutingRoutes.get('/projects/:projectId/conversations/:conversationId/routing',async c=>{
 const actor=await workflowScope(c),conversationId=c.req.param('conversationId')
 if(!await c.env.DB.prepare(`SELECT 1 FROM conversations c WHERE project_id=? AND id=? AND ${availableTicketSql()}`).bind(actor.projectId,conversationId).first())throw new HTTPException(404)
 const [row,visible,events]=await Promise.all([
  c.env.DB.prepare('SELECT d.*,v.definition_json FROM routing_decisions d JOIN workflow_rule_versions v ON v.rule_id=d.rule_id AND v.version=d.version WHERE d.project_id=? AND d.conversation_id=? ORDER BY d.created_at DESC,d.id DESC LIMIT 1').bind(actor.projectId,conversationId).first<any>(),
  workflowVisibleFields(c.env,actor.projectId,actor.id),
  c.env.DB.prepare("SELECT id,kind,state,error,attempts,next_attempt_at FROM workflow_events WHERE project_id=? AND conversation_id=? AND (error IS NOT NULL OR state='not_routed') ORDER BY id DESC LIMIT 20").bind(actor.projectId,conversationId).all()
 ])
 if(!row||!definitionVisible(JSON.parse(row.definition_json),visible.fields,visible.access))return c.json({decision:null,events:events.results})
 const {definition_json,...decision}=row;return c.json({decision:decisionData(decision),events:events.results})
})
