import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {scope} from '../../management/common'
import {auditStatement,requestSource} from '../../audit/record'
import {sendEmail,emailConfigured} from '../../integrations/email'
import {POLICY_ROLES,SECOND_FACTORS,policyRoles} from './state'
import {requireStepUp} from './step-up'
import {sharedAccountMessage,soleWorkspace,soleWorkspaceAccount} from '../sole-workspace'

/** The workspace's two-factor policy and owner-assisted factor reset. */
export const twoFactorPolicy=new Hono<AppEnv>()
const P='/projects/:projectId'
// A member's policy role: collaborators (built-in or custom) are their own row in the policy.
const policyRole=`CASE WHEN mr.role_key='collaborator' OR pr.base='collaborator' THEN 'collaborator' ELSE m.role END`
const memberRoles=`FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.id=mr.role_key AND pr.project_id=m.project_id`

twoFactorPolicy.get(`${P}/security`,async c=>{
 const actor=await scope(c,true)
 const settings=await c.env.DB.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(actor.projectId).first<{settings_json:string}>()
 const members=(await c.env.DB.prepare(`SELECT u.id,u.name,u.email,${policyRole} policy_role,EXISTS(SELECT 1 FROM user_factors f WHERE f.user_id=m.user_id AND f.confirmed_at IS NOT NULL) enrolled ${memberRoles} WHERE m.project_id=? ORDER BY u.name`).bind(actor.projectId).all<{id:string;name:string;email:string;policy_role:string;enrolled:number}>()).results
 const parsed=JSON.parse(settings?.settings_json||'{}')
 return c.json({data:{two_factor_roles:policyRoles(parsed.two_factor_roles),audit_retention_days:parsed.audit_retention_days??null,members:members.map(member=>({...member,enrolled:Boolean(member.enrolled)}))}})
})

/**
 * Turning the policy on for a role ends that role's sessions that have not proven a
 * second factor; those teammates enrol at their next sign-in before reaching any data.
 */
twoFactorPolicy.put(`${P}/security`,async c=>{
 const actor=await scope(c,true)
 if(actor.role!=='owner')throw new HTTPException(403,{message:'Only an owner can change the two-factor policy.'})
 const body=await c.req.json().catch(()=>({}))
 if(!Array.isArray(body.two_factor_roles)||body.two_factor_roles.some((role:unknown)=>!(POLICY_ROLES as readonly string[]).includes(role as string)))throw new HTTPException(400,{message:'Choose roles from owner, admin, operator and collaborator.'})
 await requireStepUp(c,actor,'two_factor.policy',{factor:true})
 const roles=[...new Set(body.two_factor_roles as string[])],now=Date.now()
 const row=await c.env.DB.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(actor.projectId).first<{settings_json:string}>()
 const before=policyRoles(JSON.parse(row?.settings_json||'{}').two_factor_roles)
 const covered=roles.map(()=>'?').join(',')||"''"
 const results=await c.env.DB.batch([
  c.env.DB.prepare("INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES(?,json_object('two_factor_roles',json(?)),?) ON CONFLICT(project_id) DO UPDATE SET settings_json=json_set(settings_json,'$.two_factor_roles',json(?)),updated_at=excluded.updated_at").bind(actor.projectId,JSON.stringify(roles),now,JSON.stringify(roles)),
  c.env.DB.prepare(`UPDATE sessions SET revoked_at=? WHERE project_id=? AND revoked_at IS NULL AND token_hash<>? AND actor_id IN (SELECT m.user_id ${memberRoles} WHERE m.project_id=? AND ${policyRole} IN (${covered})) AND token_hash NOT IN (SELECT token_hash FROM session_factors WHERE method IN (${SECOND_FACTORS.map(()=>'?').join(',')})) RETURNING token_hash`).bind(now,actor.projectId,c.get('sessionHash'),actor.projectId,...roles,...SECOND_FACTORS),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'access',action:'two_factor.policy_changed',actor:{type:'user',id:actor.id},source:requestSource(c),detail:{before,after:roles}},now),
 ])
 // D1 counts trigger writes in meta.changes; the returned rows are the sessions that ended.
 return c.json({data:{two_factor_roles:roles,sessionsEnded:results[1].results.length}})
})

/** The owner's own recent factor resets a teammate's: their factors and codes go, their sessions end, and they are told.
 * Factors are account-wide, so only an account whose sole workspace is this one is reset here. */
twoFactorPolicy.post(`${P}/agents/:userId/two-factor/reset`,async c=>{
 const actor=await scope(c,true)
 if(actor.role!=='owner')throw new HTTPException(403,{message:'Only an owner can reset a teammate’s two-factor sign-in.'})
 const userId=c.req.param('userId')
 if(userId===actor.id)throw new HTTPException(409,{message:'Manage your own factors from your profile.'})
 await requireStepUp(c,actor,'two_factor.reset',{factor:true})
 const member=await c.env.DB.prepare('SELECT u.id,u.email,u.name,p.name project FROM memberships m JOIN users u ON u.id=m.user_id JOIN projects p ON p.id=m.project_id WHERE m.project_id=? AND m.user_id=?').bind(actor.projectId,userId).first<{id:string;email:string;name:string;project:string}>()
 if(!member)throw new HTTPException(404)
 if(!await soleWorkspace(c.env.DB,userId,actor.projectId))throw new HTTPException(409,{message:sharedAccountMessage})
 const sole=soleWorkspaceAccount('?1','?2'),now=Date.now(),removed=await c.env.DB.batch([
  c.env.DB.prepare(`DELETE FROM user_factors WHERE user_id=?1 AND ${sole} RETURNING id`).bind(userId,actor.projectId),
  c.env.DB.prepare(`DELETE FROM recovery_codes WHERE user_id=?1 AND ${sole}`).bind(userId,actor.projectId),
  c.env.DB.prepare(`UPDATE sessions SET revoked_at=?3 WHERE actor_id=?1 AND revoked_at IS NULL AND ${sole}`).bind(userId,actor.projectId,now),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'auth',action:'two_factor.reset',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'member',id:userId}},now),
 ])
 let notice='not_configured'
 if(emailConfigured(c.env)){
  const receipt=await sendEmail(c.env,{to:member.email,projectId:actor.projectId,idempotencyKey:`two-factor-reset:${userId}:${now}`,subject:`Your two-factor sign-in for ${member.project} was reset`,
   text:`An owner of ${member.project} on HappyToHelp reset your two-factor sign-in. You have been signed out everywhere.\n\nSign in with your password and set up an authenticator app or passkey again.\n\nIf you did not ask for this, tell the workspace owner straight away.`})
  notice=receipt.state==='suppressed'?'suppressed':receipt.state
 }
 return c.json({data:{reset:true,factorsRemoved:removed[0].results.length,notice}})
})
