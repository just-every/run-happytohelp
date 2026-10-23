import type {Context} from 'hono'
import type {Actor,AppEnv} from '../../platform/env'
import {HTTPException} from 'hono/http-exception'
import {ticketAuthority} from '../tickets/model'
import {workflowNow} from './clock'
/** The audit receipt pins current role definition, membership and real session in
 * the same transaction as all configuration writes, matching native ticket APIs. */
export async function commitWorkflowSettings(c:Context<AppEnv>,actor:Actor,action:string,target:string,build:(accepted:string,args:unknown[])=>D1PreparedStatement[],extra?:{sql:string;params:unknown[]},detail:Record<string,unknown>={}){
 const guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash'),source:'dashboard'},'settings.manage'),receipt=crypto.randomUUID()
 const first=c.env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,'data',?,'succeeded','user',?,'dashboard','workflow',?,? WHERE EXISTS(${guard.sql}) ${extra?'AND ('+extra.sql+')':''}`).bind(receipt,actor.projectId,workflowNow(c.env),action,actor.id,target,JSON.stringify(detail),...guard.params,...(extra?.params??[]))
 const result=await c.env.DB.batch([first,...build('EXISTS(SELECT 1 FROM audit_events WHERE id=?)',[receipt])])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Workflow configuration or authority changed; reload before applying changes'})
 return result
}

export function andWorkflowGuards(...guards:{sql:string;params:unknown[]}[]){return {sql:guards.map(g=>'('+g.sql+')').join(' AND '),params:guards.flatMap(g=>g.params)}}
