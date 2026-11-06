import {ticketScopeSql} from '../access/ticket-scope'
import type {Actor,Env} from '../../platform/env'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope,text} from '../management/common'
import {releaseInterruptedInbound} from './inbound-recovery'
import {scopedInboundId} from './inbound-identity'
export const inboundRecoveryRoutes=new Hono<AppEnv>()
async function receipt(env:Env,actor:Pick<Actor,'id'|'projectId'>,messageId:string){
 const scopedId=await scopedInboundId(actor.projectId,messageId)
 return env.DB.prepare(`SELECT i.* FROM inbound_emails i WHERE i.project_id=? AND i.id IN (?,?) AND (i.conversation_id IS NULL OR EXISTS(SELECT 1 FROM conversations c WHERE c.id=i.conversation_id AND c.project_id=i.project_id AND ${ticketScopeSql('?')}))`).bind(actor.projectId,messageId,scopedId,actor.id).first()
}
inboundRecoveryRoutes.get('/projects/:projectId/inbound-emails/:messageId',async c=>{
 const actor=await scope(c,true)
 const data=await receipt(c.env,actor,c.req.param('messageId'))
 if(!data)throw new HTTPException(404)
 return c.json({data})
})
inboundRecoveryRoutes.post('/projects/:projectId/inbound-emails/:messageId/reconcile',async c=>{
 const actor=await scope(c,true)
 if(!await receipt(c.env,actor,c.req.param('messageId')))throw new HTTPException(404)
 const body=await c.req.json()
 if(!Number.isSafeInteger(body.createdAt))throw new HTTPException(400)
 return c.json(await releaseInterruptedInbound(c.env,{
  projectId:actor.projectId,messageId:c.req.param('messageId'),intentHash:text(body.intentHash,200),createdAt:body.createdAt,
  conversationId:body.conversationId===null?null:text(body.conversationId,200),claimToken:body.claimToken===null?null:text(body.claimToken,200),
  priorExecutionEnded:body.priorExecutionEnded===true,
 }))
})
