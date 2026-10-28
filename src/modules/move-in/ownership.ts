import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {canonicalJson,sha256} from '../import-kit/src/d1/index'
import {guarded} from './context'
import type {Run} from './types'
import {object} from './readers/common'

interface Bindings {owners:Record<string,string>;groups:Record<string,string>}
function bindings(input:unknown):Bindings{
 if(!object(input))throw new HTTPException(400,{message:'Choose native owners and groups'})
 const result:Bindings={owners:Object.create(null),groups:Object.create(null)}
 for(const kind of ['owners','groups'] as const){
  const values=input[kind]??{}
  if(!object(values)||Object.keys(values).length>100)throw new HTTPException(400,{message:'Choose up to 100 explicit source mappings'})
  for(const [key,value] of Object.entries(values)){
   if(!key||key.length>512||typeof value!=='string'||!value||value.length>200)throw new HTTPException(400,{message:'Invalid ownership mapping'})
   Object.defineProperty(result[kind],key,{value,enumerable:true})
  }
 }
 return result
}
const selection=`FROM conversations c JOIN move_in_origins o ON o.project_id=c.project_id AND o.target_kind='conversation' AND o.target_id=c.id
 WHERE c.project_id=?1 AND c.assigned_to IS NULL AND c.group_id IS NULL
 AND (json_extract(o.source_json,'$.ownership.ownerId') IS NOT NULL OR json_extract(o.source_json,'$.ownership.groupId') IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM conversation_ai ai WHERE ai.conversation_id=c.id AND ai.ai_id IS NOT NULL)
 AND EXISTS(SELECT 1 FROM ik_provenance p JOIN move_in_batches b ON b.kit_job_id=p.job_id WHERE b.run_id=?2 AND p.destination=c.project_id AND p.target_kind='conversation' AND p.target_id=c.id AND p.reversed=0)
 AND EXISTS(SELECT 1 FROM contacts ct WHERE ct.id=c.contact_id AND ct.project_id=c.project_id AND COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1)`
export async function ownershipOptions(env:Env,run:Run){
 if(run.state!=='completed')throw new HTTPException(409,{message:'Complete the history import before reviewing ownership'})
 const [rows,total,owners,groups,members]=await Promise.all([
  env.DB.prepare(`SELECT c.id,c.subject,c.ticket_version,c.revision,c.updated_at,c.last_message_id,c.status_category,o.source_json ${selection} ORDER BY c.id LIMIT 50`).bind(run.project_id,run.id).all<any>(),
  env.DB.prepare(`SELECT count(*) total ${selection}`).bind(run.project_id,run.id).first<{total:number}>(),
  env.DB.prepare('SELECT u.id,u.name,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.project_id=? ORDER BY u.name,u.id').bind(run.project_id).all<any>(),
  env.DB.prepare('SELECT id,name FROM ticket_groups WHERE project_id=? ORDER BY name,id').bind(run.project_id).all<any>(),
  env.DB.prepare('SELECT group_id,user_id FROM ticket_group_members WHERE project_id=? ORDER BY group_id,user_id').bind(run.project_id).all<any>()
 ])
 return {total:total?.total??0,tickets:rows.results.map(({source_json,...ticket})=>({...ticket,source:JSON.parse(source_json).ownership,sourceJson:source_json})),owners:owners.results,groups:groups.results.map(group=>({...group,members:members.results.filter(member=>member.group_id===group.id).map(member=>member.user_id)}))}
}
export async function previewOwnership(env:Env,run:Run,input:unknown){
 const chosen=bindings(input),options=await ownershipOptions(env,run),tickets=[]
 for(const [kind,key] of [['owners','ownerId'],['groups','groupId']] as const)for(const source of Object.keys(chosen[kind]))if(!options.tickets.some(ticket=>ticket.source[key]===source))throw new HTTPException(400,{message:'A mapping does not belong to this assignment page'})
 for(const ticket of options.tickets){
  const owner=ticket.source.ownerId?chosen.owners[ticket.source.ownerId]:null,group=ticket.source.groupId?chosen.groups[ticket.source.groupId]:null
  if(ticket.source.ownerId&&!owner||ticket.source.groupId&&!group)continue
  if(owner&&!options.owners.some(value=>value.id===owner)||group&&!options.groups.some(value=>value.id===group))throw new HTTPException(400,{message:'Choose current workspace members and groups'})
  if(owner&&group&&!options.groups.find(value=>value.id===group)!.members.includes(owner))throw new HTTPException(400,{message:'The chosen owner must belong to the chosen group'})
  tickets.push({...ticket,ownerId:owner,groupId:group})
 }
 const plan={runId:run.id,projectId:run.project_id,actorId:run.actor_id,bindings:chosen,tickets,total:options.total,unmapped:options.tickets.length-tickets.length,hasMore:options.total>options.tickets.length}
 return {...plan,fingerprint:sha256(canonicalJson(plan))}
}
export async function activateOwnership(env:Env,run:Run,input:unknown,fingerprint:unknown){
 const plan=await previewOwnership(env,run,input)
 if(plan.fingerprint!==fingerprint||!plan.tickets.length)throw new HTTPException(409,{message:'Review the current assignment page before applying it'})
 const db=env.DB,statements:D1PreparedStatement[]=[],at=Date.now()
 for(const ticket of plan.tickets){
  const check=`EXISTS(SELECT 1 FROM conversations c JOIN move_in_origins o ON o.project_id=c.project_id AND o.target_kind='conversation' AND o.target_id=c.id WHERE c.project_id=? AND c.id=? AND c.ticket_version=? AND c.revision=? AND c.updated_at=? AND c.last_message_id IS ? AND c.assigned_to IS NULL AND c.group_id IS NULL AND o.source_json=? AND NOT EXISTS(SELECT 1 FROM conversation_ai ai WHERE ai.conversation_id=c.id AND ai.ai_id IS NOT NULL)) AND EXISTS(SELECT 1 FROM move_in_runs WHERE id=? AND state='completed')`
  statements.push(db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN ${check} THEN 1 ELSE 0 END`).bind(run.project_id,ticket.id,ticket.ticket_version,ticket.revision,ticket.updated_at,ticket.last_message_id,ticket.sourceJson,run.id))
  if(ticket.ownerId)statements.push(db.prepare('INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM memberships WHERE project_id=? AND user_id=?) THEN 1 ELSE 0 END').bind(run.project_id,ticket.ownerId))
  if(ticket.groupId)statements.push(db.prepare('INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM ticket_groups WHERE project_id=? AND id=?) THEN 1 ELSE 0 END').bind(run.project_id,ticket.groupId))
  if(ticket.ownerId&&ticket.groupId)statements.push(db.prepare('INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM ticket_group_members WHERE project_id=? AND group_id=? AND user_id=?) THEN 1 ELSE 0 END').bind(run.project_id,ticket.groupId,ticket.ownerId))
 }
 for(const ticket of plan.tickets){
  // Assignment is explicitly authorized, but history import never runs rules,
  // sends notifications, changes lifecycle, or grants historical staff access.
  const now=Math.max(at,ticket.updated_at+1),receipt=crypto.randomUUID()
  statements.push(db.prepare('INSERT INTO move_in_native_fences(project_id,conversation_id) VALUES(?,?)').bind(run.project_id,ticket.id),
   db.prepare("INSERT INTO ticket_history(id,project_id,conversation_id,actor_id,actor_type,source,at,changes_json) VALUES(?,?,?,?,'user','move-in-ownership',?,?)").bind(receipt,run.project_id,ticket.id,run.actor_id,now,JSON.stringify({assigned_to:{from:null,to:ticket.ownerId},group_id:{from:null,to:ticket.groupId},source_owner_id:ticket.source.ownerId,source_group_id:ticket.source.groupId})),
   db.prepare("UPDATE conversations SET assigned_to=?,group_id=?,ticket_actor_id=?,ticket_actor_type='user',ticket_source='move-in-ownership',updated_at=? WHERE project_id=? AND id=?").bind(ticket.ownerId,ticket.groupId,run.actor_id,now,run.project_id,ticket.id),
   db.prepare('DELETE FROM move_in_native_fences WHERE project_id=? AND conversation_id=?').bind(run.project_id,ticket.id))
 }
 try{await guarded(env,run,statements)}catch{throw new HTTPException(409,{message:'Tickets, membership or import authority changed. Review the assignments again.'})}
 return {applied:plan.tickets.length,remaining:plan.total-plan.tickets.length}
}
