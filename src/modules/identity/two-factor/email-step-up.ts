import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {hashToken,requireActor} from '../../../platform/auth'
import {serverSecret} from '../../../platform/db'
import {clientAddress} from '../../../platform/rate-limits'
import {loginDestination} from '../../../platform/dashboard-path'
import {requestSource} from '../../audit/record'
import {emailConfigured,sendEmail} from '../../integrations/email'
import {emailMode,emailOffMessage} from '../../integrations/email-provider'
import {linkOrigin,magicLinkLimit} from '../magic-link'
import {accountAudit,runAll} from './factors'

export const emailStepUp=new Hono<AppEnv>()

/** Mailbox proof creates a fresh sign-in session; merely holding this session never refreshes it. */
emailStepUp.post('/step-up/email',async c=>{
 const actor=await requireActor(c)
 if(actor.role==='contact'||actor.security?.hasFactor)throw new HTTPException(403)
 const audit=async(action:string,outcome:'succeeded'|'refused'='succeeded',reason?:string)=>runAll(c.env.DB,await accountAudit(c.env.DB,actor.id,{category:'auth',action,outcome,actor:{type:'user',id:actor.id},source:requestSource(c),detail:{method:'email_link',...(reason?{reason}:{})}}))
 const origin=linkOrigin(c.env)
 if(emailMode(c.env)==='local'||!origin||!emailConfigured(c.env)){
  await audit('step_up.email_link_refused','refused','email_unavailable')
  throw new HTTPException(503,{message:`${emailOffMessage} Contact the workspace owner.`})
 }
 const user=await c.env.DB.prepare('SELECT email FROM users WHERE id=?').bind(actor.id).first<{email:string}>()
 if(!user)throw new HTTPException(401)
 try{
  // Share the primary sign-in counters: alternate doors cannot multiply the account allowance.
  await magicLinkLimit(c.env.DB,`ip:${clientAddress(c.req)}`,30)
  await magicLinkLimit(c.env.DB,`email:${user.email.toLowerCase()}`,5)
 }catch(error){await audit('step_up.email_link_refused','refused','rate_limited');throw error}
 const body=await c.req.json().catch(()=>({})),token=serverSecret(),hash=await hashToken(token)
 await c.env.DB.prepare('INSERT INTO magic_signins(token_hash,user_id,project_id,email,expires_at) VALUES(?,?,?,?,?)').bind(hash,actor.id,actor.projectId||null,user.email,Date.now()+15*60*1000).run()
 const url=new URL('/login/magic',origin)
 url.searchParams.set('returnTo',loginDestination(body.returnTo,origin))
 url.hash=new URLSearchParams({token}).toString()
 await audit('step_up.email_link_requested')
 try{
  await sendEmail(c.env,{to:user.email,subject:'Confirm your HappyToHelp sign-in',text:`Open this link in the same browser, then press Sign in within 15 minutes: ${url.href}\nReturn to your original tab to continue. If you did not request this link, ignore this email.`,projectId:actor.projectId||undefined,idempotencyKey:`magic-signin:${hash}`})
 }catch(error){
  await c.env.DB.prepare('UPDATE magic_signins SET consumed_at=? WHERE token_hash=?').bind(Date.now(),hash).run()
  throw error
 }
 c.header('Cache-Control','no-store')
 return c.json({accepted:true},202)
})
