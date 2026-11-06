import {Hono} from 'hono'
import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {requiredString} from '../../platform/db'
import {scope} from './common'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement,requestSource} from '../audit/record'
import {sendEmail,emailConfigured,emailOffMessage} from '../integrations/email'
import {INVITATION_LIFETIME_SECONDS,issueInvitation,manageableInvitation,revokeInvitation} from './invitation-store'

export const invitations=new Hono<AppEnv>()
/** The invitation email says who invited whom to what, what HappyToHelp is, and what the link does. */
async function mailInvitation(env:AppEnv['Bindings'],projectId:string,inviterId:string,email:string,role:string,hash:string,url:string){
 const found=await env.DB.prepare('SELECT p.name project,u.name inviter,u.email inviter_email FROM projects p LEFT JOIN users u ON u.id=? WHERE p.id=?').bind(inviterId,projectId).first<{project:string;inviter:string|null;inviter_email:string|null}>()
 const project=found?.project||'a HappyToHelp workspace',inviter=found?.inviter||found?.inviter_email||'A teammate',as=role==='owner'?'an owner':role==='admin'?'an admin':role==='collaborator'?'a collaborator':'an agent'
 const text=[
  `${inviter} invited you to join ${project} on HappyToHelp as ${as}.`,
  'HappyToHelp is where your team answers customers: website chat, email replies and help articles in one inbox.',
  `Accept the invitation and create your account:\n${url}`,
  `The link works for ${Math.round(INVITATION_LIFETIME_SECONDS/3600)} hours and only for ${email}. If you were not expecting this, ignore this email.`,
 ].join('\n\n')
 return sendEmail(env,{to:email,subject:`${inviter} invited you to ${project} on HappyToHelp`,text,projectId,idempotencyKey:`invite:${hash}`})
}

invitations.post('/projects/:projectId/agents',async c=>{
 const a=await scope(c,true),b=await c.req.json(),email=requiredString(b.email||b.invitation_email,'email',320).toLowerCase()
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HTTPException(400)
 const role=b.role||'operator'
 if(!['operator','collaborator','admin','owner'].includes(role)||a.role!=='owner'&&!['operator','collaborator'].includes(role))throw new HTTPException(403)
 // Granting the admin or owner role is a role change: it needs a recent step-up.
 if(role==='admin'||role==='owner')await requireStepUp(c,a,'member.invite')
 const member=await c.env.DB.prepare('SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.project_id=? AND lower(u.email)=?').bind(a.projectId,email).first()
 if(member)throw new HTTPException(409,{message:'Already a project member'})
 const invitation=await issueInvitation(c.env.DB,String(c.env.APP_ORIGIN||new URL(c.req.url).origin),a.projectId,email,role)
 let delivery='not_configured'
 if(emailConfigured(c.env)){const receipt=await mailInvitation(c.env,a.projectId,a.id,email,role,invitation.hash,invitation.url);delivery=receipt.state==='suppressed'?'suppressed':'sent'}
 await auditStatement(c.env.DB,{projectId:a.projectId,category:'access',action:'member.invited',actor:{type:'user',id:a.id},source:requestSource(c),target:{type:'invitation',id:invitation.hash.slice(0,16)},detail:{role}}).run()
 return c.json({data:{email,role,invitationUrl:invitation.url,expiresIn:INVITATION_LIFETIME_SECONDS,delivery}},201)
})

// Each of these re-reads the caller's membership of the path's workspace and refuses any invitation the
// caller may not manage, so a pending row's id is never enough on its own.
invitations.delete('/projects/:projectId/invitations/:invitationId',async c=>{
 const a=await scope(c,true),invitation=await manageableInvitation(c.env.DB,a.projectId,c.req.param('invitationId'),a.role)
 await revokeInvitation(c.env.DB,a.projectId,invitation.email)
 return c.json({revoked:true})
})

type Manager=Awaited<ReturnType<typeof scope>>
/**
 * Copying or resending issues a new, valid link for the invitation's role, so it is held to the same
 * rules as inviting: only an owner manages an admin or owner invitation, and with a recent step-up.
 */
async function reissuable(c:Context<AppEnv>,a:Manager){
 const invitation=await manageableInvitation(c.env.DB,a.projectId,c.req.param('invitationId')!,a.role)
 if(invitation.role==='admin'||invitation.role==='owner')await requireStepUp(c,a,'member.invite')
 return invitation
}
const reissued=(c:Context<AppEnv>,a:Manager,role:string,hash:string,via:'link'|'email')=>auditStatement(c.env.DB,{projectId:a.projectId,category:'access',action:'member.invitation_reissued',actor:{type:'user',id:a.id},source:requestSource(c),target:{type:'invitation',id:hash.slice(0,16)},detail:{role,via}}).run()

// A link is stored only as a hash, so an existing one cannot be shown again. Copying issues another link
// for the same invitation; links already sent keep working until they expire or the invitation is revoked.
invitations.post('/projects/:projectId/invitations/:invitationId/link',async c=>{
 const a=await scope(c,true),invitation=await reissuable(c,a)
 const link=await issueInvitation(c.env.DB,String(c.env.APP_ORIGIN||new URL(c.req.url).origin),a.projectId,invitation.email,invitation.role)
 await reissued(c,a,invitation.role,link.hash,'link')
 return c.json({data:{email:invitation.email,role:invitation.role,invitationUrl:link.url,expiresIn:INVITATION_LIFETIME_SECONDS}},201)
})

invitations.post('/projects/:projectId/invitations/:invitationId/resend',async c=>{
 const a=await scope(c,true),invitation=await reissuable(c,a)
 if(!emailConfigured(c.env))throw new HTTPException(503,{message:`${emailOffMessage} The invitation cannot be emailed: copy the link and share it instead.`})
 const link=await issueInvitation(c.env.DB,String(c.env.APP_ORIGIN||new URL(c.req.url).origin),a.projectId,invitation.email,invitation.role)
 const receipt=await mailInvitation(c.env,a.projectId,a.id,invitation.email,invitation.role,link.hash,link.url)
 await reissued(c,a,invitation.role,link.hash,'email')
 return c.json({data:{email:invitation.email,role:invitation.role,expiresIn:INVITATION_LIFETIME_SECONDS,delivery:receipt.state==='suppressed'?'suppressed':'sent'}},201)
})
