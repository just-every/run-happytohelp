import type {Env} from '../../platform/env'
import {invalid,fieldAllowed} from '../tickets/model'
import {memberAccess} from '../access/gate'
import {HTTPException} from 'hono/http-exception'
import {validateFieldValue} from '../tickets/fields'
import type {RuleDefinition} from './rule-model'
/** Validate references both when authored and when published. Runtime transactions
 * independently recheck mutable membership/schema/frontiers at commit. */
export async function validateRuleReferences(env:Env,projectId:string,d:RuleDefinition,actorId:string){
 const access=await memberAccess(env.DB,projectId,actorId);if(!access)throw new HTTPException(403)
 const predicates:string[]=[],params:unknown[]=[]
 const field=async(id:string,write=false)=>{const f=await env.DB.prepare('SELECT * FROM ticket_fields WHERE project_id=? AND id=?').bind(projectId,id).first<any>();if(!f)invalid('Unknown workflow field');if(!fieldAllowed(f,access)||write&&!fieldAllowed(f,access,true))throw new HTTPException(403,{message:'Your role cannot use this workflow field'});predicates.push('EXISTS(SELECT 1 FROM ticket_fields WHERE project_id=? AND id=? AND updated_at=?)');params.push(projectId,id,f.updated_at);return f}
 const requireRow=async(sql:string,args:unknown[],message:string)=>{if(!await env.DB.prepare(sql).bind(...args).first())invalid(message);predicates.push(`EXISTS(${sql})`);params.push(...args)}
 for(const c of [...d.conditions.all,...d.conditions.any])if(c.field.startsWith('field:'))await field(c.field.slice(6))
 for(const a of d.actions){switch(a.type){
  case 'status':await requireRow('SELECT 1 FROM ticket_statuses WHERE project_id=? AND id=? AND active=1',[projectId,a.status_id],'Unknown active status');break
  case 'assign':if(a.user_id)await requireRow('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?',[projectId,a.user_id],'Unknown workspace assignee');if(a.group_id)await requireRow('SELECT 1 FROM ticket_groups WHERE project_id=? AND id=?',[projectId,a.group_id],'Unknown workspace group');break
  case 'tags':for(const tag of [...a.add??[],...a.remove??[]])await requireRow('SELECT 1 FROM workspace_tags WHERE project_id=? AND id=?',[projectId,tag],'Unknown workspace tag');break
  case 'fields':for(const [id,value] of Object.entries(a.values)){const f=await field(id,true);validateFieldValue(f,value)}break
  case 'notify':if(a.recipient_id)await requireRow('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?',[projectId,a.recipient_id],'Unknown notification recipient');break
 }}
 if(d.routing){if(d.routing.user_id)await requireRow('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?',[projectId,d.routing.user_id],'Unknown routing operator');for(const id of [d.routing.group_id,d.routing.overflow_group_id])if(id)await requireRow('SELECT 1 FROM ticket_groups WHERE project_id=? AND id=?',[projectId,id],'Unknown responsible routing group')}
 if(d.time?.calendar_id)await requireRow('SELECT 1 FROM workflow_calendars WHERE project_id=? AND id=? AND active=1',[projectId,d.time.calendar_id],'Choose an active business-hours calendar')
 return {sql:predicates.length?predicates.join(' AND '):'1',params}
}
