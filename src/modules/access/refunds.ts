import {ticketAuthority} from '../tickets/model'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {memberAccess} from './gate'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement,requestSource} from '../audit/record'
import {hashToken} from '../../platform/auth'
import {text} from '../identity/enterprise/model'

/** An approval records permission to refund; no payment provider executes here.
 * A consumer must revalidate the approver and expiry before submitting money. */
export const refunds=new Hono<AppEnv>()
const P='/projects/:projectId/refund-approvals'
refunds.post(P,async c=>{
 const actor=await scope(c),access=await memberAccess(c.env.DB,actor.projectId,actor.id)
 if(!access?.permissions.has('refunds.approve')){await auditStatement(c.env.DB,{projectId:actor.projectId,category:'approval',action:'refund.approval_denied',outcome:'refused',actor:{type:'user',id:actor.id},source:requestSource(c)}).run();throw new HTTPException(403,{message:'Refund approval permission required'})}
 await requireStepUp(c,actor,'refund.approve')
 const guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash'),source:requestSource(c)},'refunds.approve')
 const b=await c.req.json(),conversationId=text(b.conversationId),reference=text(b.paymentReference),key=text(b.requestKey),currency=text(b.currency,3)
 if(!Number.isSafeInteger(b.amountMinor)||b.amountMinor<=0||b.amountMinor>100000000||! /^[A-Z]{3}$/.test(currency))throw new HTTPException(400,{message:'Specify a positive amount in minor units and a currency'})
 if(!await c.env.DB.prepare('SELECT 1 FROM conversations WHERE id=? AND project_id=?').bind(conversationId,actor.projectId).first())throw new HTTPException(404)
 const hash=await hashToken(JSON.stringify({conversationId,reference,amount:b.amountMinor,currency,actor:actor.id})),id=crypto.randomUUID(),now=Date.now()
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO refund_approvals SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(${guard.sql}) ON CONFLICT(project_id,request_key) DO NOTHING`).bind(id,actor.projectId,conversationId,reference,b.amountMinor,currency,actor.id,key,hash,now,now+15*60000,...guard.params),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'approval',action:'refund.approved',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'refund_approval',id}},now,{sql:'EXISTS(SELECT 1 FROM refund_approvals WHERE id=?)',params:[id]}),
 ])
 const row=await c.env.DB.prepare('SELECT id,request_hash,expires_at FROM refund_approvals WHERE project_id=? AND request_key=?').bind(actor.projectId,key).first<{id:string;request_hash:string;expires_at:number}>()
 if(!row)throw new HTTPException(403,{message:'Approval authority was withdrawn'})
 if(row.request_hash!==hash)throw new HTTPException(409,{message:'This approval key already describes a different refund'})
 return c.json({data:{id:row.id,status:'approved_not_submitted',expiresAt:row.expires_at,submitted:false}},result[0].meta.changes?201:200)
})
