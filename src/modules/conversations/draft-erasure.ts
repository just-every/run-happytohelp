import type {Env} from '../../platform/env'
/** Draft-specific pending displays contain reply text. Erasure cancels those displays
 * while retaining the audit's class, decision and operational identifiers. */
export function replyDraftErasure(env:Env,projectId:string,contactId:string){
 const selected="json_extract(saved,'$.tool')='happytohelp.conversations.draft' AND json_extract(saved,'$.summary.nativeTarget.id') IN (SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2)"
 return [
  env.DB.prepare(`DELETE FROM agent_door_approvals WHERE ${selected}`).bind(projectId,contactId),
  env.DB.prepare(`DELETE FROM agent_door_reviews WHERE ${selected}`).bind(projectId,contactId),
 ]
}
/** An installation's linked project owns these new tool records. Other tools keep
 * their existing custody. Native member erasure has already fenced the whole batch. */
export function replyDraftMemberErasure(env:Env,projectId:string,userId:string){
 const owned="EXISTS(SELECT 1 FROM h2h_business_project WHERE project_id=?1) AND json_extract(saved,'$.tool')='happytohelp.conversations.draft' AND (json_extract(saved,'$.principal.person.id')=?2 OR EXISTS(SELECT 1 FROM json_each(saved,'$.principal.approvers') WHERE json_extract(value,'$.id')=?2))"
 return [
  env.DB.prepare(`DELETE FROM agent_door_approvals WHERE ${owned}`).bind(projectId,userId),
  env.DB.prepare(`DELETE FROM agent_door_reviews WHERE ${owned}`).bind(projectId,userId),
 ]
}
