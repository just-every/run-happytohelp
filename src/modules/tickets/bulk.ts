import {queueTicketContinuation} from './continuation'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Actor,AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {boundedDatabase} from '../../platform/d1-budget'
import {ticketBatchEnvironment,TicketCapacityError} from './request-batch'
import {finishBatchWorkflows} from './batch-workflows'
import {requestRoom,flushRequestAssignments} from '../integrations/notification-request'
import {auditStatement,requestSource} from '../audit/record'
import {mutateTicket,previewTicket,TicketCommittedError} from './mutate'

interface Selection {id:string;expected_version:number}
interface BulkInput {tickets:Selection[];changes:Record<string,unknown>}
function input(body:unknown):BulkInput{
 if(!body||typeof body!=='object')throw new HTTPException(400,{message:'A bulk selection and changes are required'})
 const {tickets,changes}=body as BulkInput
 if(!Array.isArray(tickets)||!tickets.length||tickets.length>100)throw new HTTPException(400,{message:'Select 1–100 tickets'})
 const seen=new Set<string>()
 for(const item of tickets){
  if(!item||typeof item.id!=='string'||!item.id||item.id.length>160||seen.has(item.id)||!Number.isSafeInteger(item.expected_version)||item.expected_version<0)throw new HTTPException(400,{message:'Each ticket needs a unique id and expected_version'})
  seen.add(item.id)
 }
 const allowed=['assigned_to','add_tags','remove_tags','priority','status_id']
 if(!changes||typeof changes!=='object'||Array.isArray(changes)||!Object.keys(changes).length||Object.keys(changes).some(key=>!allowed.includes(key)))throw new HTTPException(400,{message:'Bulk changes may only assign, tag or change priority/status'})
 return {tickets,changes}
}
export const bulkRoutes=new Hono<AppEnv>()
for(const action of ['preview','apply'] as const)bulkRoutes.post(`/projects/:projectId/tickets/bulk/${action}`,async c=>{
 const actor=await scope(c) as Actor,body=input(await c.req.json()),results:Record<string,unknown>[]=[],batchId=crypto.randomUUID()
 c.env=await ticketBatchEnvironment(c.env,actor,body.tickets.map(t=>t.id))
 const event=(id:string,result:string)=>({projectId:actor.projectId,category:'data' as const,action:`ticket.bulk.${action}`,outcome:result==='failed'?'failed' as const:['ready','applied'].includes(result)?'succeeded' as const:'refused' as const,actor:{type:'user' as const,id:actor.id},source:requestSource(c),target:{type:'conversation',id},detail:{batch_id:batchId,result,fields:Object.keys(body.changes)}})
 // Each receipt rechecks live role, privacy, schema and ticket frontier.
 for(const selected of body.tickets){
  if(requestRoom(c.env)<96){results.push({id:selected.id,status:'failed',committed:false,code:'request_capacity',reason:'This ticket was not changed. Apply the remaining selection in a new request.'});continue}
  const unit=boundedDatabase(c.env.DB,requestRoom(c.env)),env={...c.env,DB:unit.database}
  try{
   const change={...body.changes,expected_ticket_version:selected.expected_version},authority={sessionHash:c.get('sessionHash'),source:requestSource(c)}
   if(action==='preview'){
    const preview=await previewTicket(env,actor,selected.id,change,authority)
    results.push({id:selected.id,status:'ready',expected_version:selected.expected_version,changes:preview.changes})
   }else{
    const ticket=await mutateTicket(env,actor,selected.id,change,authority,event(selected.id,'applied'))
    results.push({id:selected.id,status:'applied',committed:true,ticket_version:ticket.ticket_version})
   }
  }catch(error){
  if(error instanceof TicketCapacityError){results.push({id:selected.id,status:'failed',committed:false,code:'request_capacity',reason:error.message});continue}
   if(error instanceof TicketCommittedError){results.push({id:selected.id,status:'applied',committed:true,ticket_version:error.ticketVersion,refresh_error:true});continue}
   const status=error instanceof HTTPException?error.status===409?'stale':[401,403,404].includes(error.status)?'forbidden':[400,422].includes(error.status)?'invalid':'failed':'failed'
   // Conceal other workspaces and report an unconfirmed operation without replaying it.
   const reason=status==='forbidden'?'Ticket is unavailable or your role cannot change it':status==='failed'?(action==='apply'?'The update outcome could not be confirmed. Reload this ticket before trying again.':'The preview could not be completed.'):(error as Error).message||'Ticket change refused'
   if(status==='failed')console.error('Ticket bulk operation failed',{batch_id:batchId,id:selected.id,action})
   results.push({id:selected.id,status,reason})
  }
  const result=results[results.length-1]
  if(result.status!=='applied'){try{await auditStatement(c.env.DB,event(selected.id,String(result.status))).run()}catch{result.audit_error=true}}
 }
 if(action==='apply'){
  await queueTicketContinuation(c.env,{actor,authority:{sessionHash:c.get('sessionHash'),source:requestSource(c)},tickets:body.tickets,changes:body.changes,batchId},results)
  const applied=results.filter(r=>r.status==='applied').map(r=>String(r.id))
  await finishBatchWorkflows(c.env,actor.projectId,applied)
  await flushRequestAssignments(c.env)
  try{const versions=await c.env.DB.prepare('SELECT id,ticket_version FROM conversations WHERE project_id=? AND id IN (SELECT value FROM json_each(?))').bind(actor.projectId,JSON.stringify(applied)).all<{id:string;ticket_version:number}>()
  const latest=new Map(versions.results.map(t=>[t.id,t.ticket_version]));for(const r of results)if(latest.has(String(r.id)))r.ticket_version=latest.get(String(r.id))
  }catch{for(const r of results)if(r.status==='applied')r.refresh_error=true}
 }
 const counts:Record<string,number>={}
 for(const result of results){const status=String(result.status);counts[status]=(counts[status]||0)+1}
 return c.json({data:{batch_id:batchId,results,counts}})
})
