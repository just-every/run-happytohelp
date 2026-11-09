import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,ActorSecurity} from '../../../platform/env'
import {auditStatement,requestSource} from '../../audit/record'
import {recentMailboxProof,recentStepUp} from './state'
import {jsonResponse} from '../../../platform/json-response'
import {afterReads} from '../../../platform/read-effects'

/**
 * Exports, erasure, role changes, credential installs, refund approval and the
 * two-factor policy need a recent step-up: the second factor within 15 minutes, or
 * the password for an account without one. `factor` demands a second factor even
 * then (resetting a teammate's factor). The local rer dev entry is installation custody.
 */
export async function requireStepUp(c:Context<AppEnv>,actor:{id:string;projectId:string;security?:ActorSecurity},purpose:string,{factor=false,mailbox=false}:{factor?:boolean;mailbox?:boolean}={}){
 const security=actor.security
 if(!security)throw new HTTPException(403)
 if(factor&&!security.hasFactor&&!security.installation)
  throw new HTTPException(403,{res:jsonResponse({error:'Set up two-factor sign-in for your own account first.',code:'two_factor_setup_required'},403)})
 if(mailbox?recentMailboxProof(security):recentStepUp(security))return
 // On a read (an export door, the mailbox callback) the refusal is recorded once, after the read's own D1 reads (platform/read-effects.ts).
 if(actor.projectId)await afterReads(c,auditStatement(c.env.DB,{projectId:actor.projectId,category:'auth',action:'step_up.required',outcome:'refused',actor:{type:'user',id:actor.id},source:requestSource(c),purpose}))
 const hasPassword=Boolean(await c.env.DB.prepare('SELECT 1 FROM credentials WHERE user_id=?').bind(actor.id).first())
 throw new HTTPException(403,{res:jsonResponse({accountId:actor.id,error:mailbox?'Confirm it is you with an email sign-in link, then try again.':security.hasFactor?'Confirm it is you with your authenticator code or passkey, then try again.':hasPassword?'Confirm your password, then try again.':'Confirm it is you with an email sign-in link, then try again.',code:'step_up_required',methods:mailbox?['email_link']:security.hasFactor?['totp','webauthn','recovery']:hasPassword?['password','email_link']:['email_link'],purpose},403)})
}
