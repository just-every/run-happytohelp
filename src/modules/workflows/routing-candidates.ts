import {conversationHasMessages} from '../management/inbox-visible'
import type {Env} from '../../platform/env'
import type {RuleDefinition} from './rule-model'
/** Membership, role, team, live availability, skills and workload are all current
 * facts. Historical imported owners never become assignable staff. */
export const routingMemberSql=(alias='m')=>`(${alias}.role='owner' OR (coalesce(mr.role_key,'')<>'collaborator' AND (pr.id IS NULL OR pr.base IN ('admin','operator') AND EXISTS(SELECT 1 FROM json_each(pr.permissions_json) WHERE value='conversations.manage'))))`
export async function routingCandidates(env:Env,projectId:string,routing:NonNullable<RuleDefinition['routing']>,groupId?:string){
 const rows=await env.DB.prepare(`SELECT m.user_id,o.capacity,o.skills_json,o.updated_at,(SELECT count(*) FROM conversations c WHERE c.project_id=m.project_id AND c.assigned_to=m.user_id AND c.status_category NOT IN ('solved','closed') AND ${conversationHasMessages()}) workload FROM memberships m JOIN routing_operators o ON o.project_id=m.project_id AND o.user_id=m.user_id LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key WHERE m.project_id=? AND o.available=1 AND o.capacity>0 AND ${routingMemberSql()} ${groupId?'AND EXISTS(SELECT 1 FROM ticket_group_members gm WHERE gm.project_id=m.project_id AND gm.user_id=m.user_id AND gm.group_id=?)':''} ${routing.strategy==='named'?'AND m.user_id=?':''} ORDER BY m.user_id`).bind(projectId,...(groupId?[groupId]:[]),...(routing.strategy==='named'?[routing.user_id]:[])).all<any>()
 return rows.results.filter(row=>row.workload<row.capacity&&routing.skills.every(skill=>JSON.parse(row.skills_json).includes(skill)))
}
export function chooseCandidate(candidates:any[],strategy:string,lastUserId:string|null){
 if(!candidates.length)return null
 let ordered=[...candidates]
 if(strategy==='capacity'){const least=Math.min(...ordered.map(c=>c.workload));ordered=ordered.filter(c=>c.workload===least)}
 // Rotation breaks equal-load ties and prevents a lexicographic first member
 // from starving teammates across restarts or concurrent invocations.
 return ordered.find(c=>lastUserId===null||c.user_id>lastUserId)??ordered[0]
}
