import {ticketScopeSql} from '../access/ticket-scope'
import {queueTicketContinuation} from '../tickets/continuation'
import {boundedDatabase} from '../../platform/d1-budget'
import {ticketBatchEnvironment,TicketCapacityError} from '../tickets/request-batch'
import {finishBatchWorkflows} from '../tickets/batch-workflows'
import {requestRoom,flushRequestAssignments} from '../integrations/notification-request'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Actor} from '../../platform/env'
import {scope} from '../management/common'
import {getTicket,ticketAuthority,invalid,object,availableTicketSql} from '../tickets/model'
import {requestSource} from '../audit/record'
import {assertMacroFieldsReadable} from './read-access'
import {listMacros,readMacro,macroData,saveMacro,archiveMacro} from './store'
import {prepareMacro,type MacroSelection} from './preview'
import {applyMacro,readDraft,discardDraft} from './apply'
export const macroRoutes=new Hono<AppEnv>()
const base='/projects/:projectId/macros'
const authority=(c:any)=>({sessionHash:c.get('sessionHash'),source:requestSource(c)})
macroRoutes.get(base,async c=>{const actor=await scope(c) as Actor;return c.json(await listMacros(c.env,actor,c.req.query('search')??'',Number(c.req.query('page')??1),Number(c.req.query('limit')??50),c.req.query('sort')??'title',c.req.query('direction')??'asc'))})
macroRoutes.post(base,async c=>{const actor=await scope(c) as Actor;return c.json({data:await saveMacro(c.env,actor,await c.req.json(),authority(c))},201)})
macroRoutes.get(`${base}/attachment-options`,async c=>{
 const actor=await scope(c) as Actor
 await ticketAuthority(c.env,actor,authority(c),'conversations.reply')
 const rows=await c.env.DB.prepare(`SELECT media.id,media.filename,media.content_type,media.size,c.subject FROM media JOIN conversations c ON c.id=media.conversation_id WHERE media.project_id=? AND c.project_id=media.project_id AND media.uploaded_by=? AND ${availableTicketSql()} AND ${ticketScopeSql('?')} ORDER BY media.created_at DESC LIMIT 200`).bind(actor.projectId,actor.id,actor.id).all()
 return c.json({data:rows.results})
})
macroRoutes.get(`${base}/:macroId`,async c=>{const actor=await scope(c) as Actor,{row}=await readMacro(c.env,actor,c.req.param('macroId'));return c.json({data:{...macroData(row),id:row.macro_id}})})
macroRoutes.put(`${base}/:macroId`,async c=>{const actor=await scope(c) as Actor;return c.json({data:await saveMacro(c.env,actor,await c.req.json(),authority(c),c.req.param('macroId'))})})
macroRoutes.delete(`${base}/:macroId`,async c=>{const actor=await scope(c) as Actor,body=await c.req.json().catch(()=>({})),{row}=await readMacro(c.env,actor,c.req.param('macroId'));if(body.expected_version!==undefined&&!Number.isSafeInteger(body.expected_version))invalid('expected_version is invalid');await archiveMacro(c.env,actor,c.req.param('macroId'),body.expected_version??row.version,authority(c));return c.json({deleted:true})})
macroRoutes.get(`${base}/:macroId/versions`,async c=>{
 const actor=await scope(c) as Actor,{row}=await readMacro(c.env,actor,c.req.param('macroId'))
 // Historical versions can include fields and scopes no longer visible to ordinary
 // users. Only authorized maintainers can inspect their immutable snapshots.
 const personal=JSON.parse(row.scope_json).visibility==='personal'
 if(personal?row.owner_id!==actor.id:!['owner','admin'].includes(actor.role))throw new HTTPException(403)
 await ticketAuthority(c.env,actor,authority(c),personal?'conversations.reply':'settings.manage')
 const rows=await c.env.DB.prepare('SELECT * FROM macro_versions WHERE project_id=? AND macro_id=? ORDER BY version DESC LIMIT 200').bind(actor.projectId,row.macro_id).all<any>()
 for(const row of rows.results)await assertMacroFieldsReadable(c.env,actor,row)
 return c.json({data:rows.results.map(macroData)})
})
macroRoutes.get(`${base}/:macroId/usage`,async c=>{
 const actor=await scope(c) as Actor,{row}=await readMacro(c.env,actor,c.req.param('macroId'))
 const personal=JSON.parse(row.scope_json).visibility==='personal'
 if(personal?row.owner_id!==actor.id:!['owner','admin'].includes(actor.role))throw new HTTPException(403)
 await ticketAuthority(c.env,actor,authority(c),personal?'conversations.reply':'settings.manage')
 return c.json({data:(await c.env.DB.prepare(`SELECT u.version,u.actor_id,count(*) uses,max(u.created_at) last_used_at FROM macro_usage u JOIN conversations c ON c.id=u.conversation_id AND c.project_id=u.project_id WHERE u.project_id=? AND u.macro_id=? AND ${ticketScopeSql('?')} GROUP BY u.version,u.actor_id ORDER BY u.version DESC,uses DESC`).bind(actor.projectId,row.macro_id,actor.id).all()).results})
})
for(const action of ['preview','apply'] as const)macroRoutes.post(`${base}/:macroId/${action}`,async c=>{
 const actor=await scope(c) as Actor,body=object(await c.req.json()),macroId=c.req.param('macroId'),tickets:MacroSelection[]=body.tickets??[{id:body.conversation_id,expected_version:body.expected_ticket_version}]
 if(!Array.isArray(tickets)||!tickets.length||tickets.length>100||new Set(tickets.map(t=>t?.id)).size!==tickets.length||tickets.some(t=>!t||typeof t.id!=='string'||!t.id||t.id.length>200))invalid('Select 1–100 unique tickets')
 if(action==='apply'&&(typeof body.command_id!=='string'||!body.command_id||body.command_id.length>200))invalid('A unique command_id is required')
 const results=[]
 if(tickets.length>1)c.env=await ticketBatchEnvironment(c.env,actor,tickets.map(t=>t.id))
 for(const selected of tickets){
  if(requestRoom(c.env)<96){results.push({id:selected.id,status:'failed',committed:false,code:'request_capacity',reason:'This ticket was not changed. Apply the remaining selection in a new request.'});continue}
  const unit=boundedDatabase(c.env.DB,requestRoom(c.env)),env={...c.env,DB:unit.database}
  try{
  const result=action==='preview'?(await prepareMacro(env,actor,macroId,body.version,selected,authority(c))).preview:await applyMacro(env,actor,macroId,body.version,selected,body.command_id,authority(c))
  results.push(result)
 }catch(error){
  if(error instanceof TicketCapacityError){results.push({id:selected.id,status:'failed',committed:false,code:'request_capacity',reason:error.message});continue}
  if(!(error instanceof HTTPException)){console.error('Macro operation failed',error);results.push({id:selected.id,status:'failed',reason:'The operation outcome could not be confirmed. Reload before trying again.'});continue}
  const status=error.status===409?'stale':[401,403,404].includes(error.status)?'forbidden':[400,422].includes(error.status)?'invalid':'failed'
  results.push({id:selected.id,status,reason:status==='forbidden'?'Macro or ticket is unavailable for your current permissions':error.message})
 }}
 if(action==='apply'&&tickets.length>1){
  await queueTicketContinuation(c.env,{actor,authority:authority(c),tickets,macro:{id:macroId,version:body.version,commandId:body.command_id},batchId:crypto.randomUUID()},results)
  await finishBatchWorkflows(c.env,actor.projectId,results.filter(r=>r.status==='applied').map(r=>r.id))
  await flushRequestAssignments(c.env)
 }
 return c.json({data:{results}})
})
macroRoutes.get('/projects/:projectId/conversations/:conversationId/macro-draft',async c=>{const actor=await scope(c) as Actor;await getTicket(c.env,actor,c.req.param('conversationId'));return c.json({data:await readDraft(c.env,actor,c.req.param('conversationId'))})})
// Clearing the composer discards the operator's own draft of that macro use, so a reload never brings it back.
macroRoutes.delete('/projects/:projectId/conversations/:conversationId/macro-draft',async c=>{const actor=await scope(c) as Actor;await getTicket(c.env,actor,c.req.param('conversationId'));return c.json({data:{discarded:await discardDraft(c.env,actor,c.req.param('conversationId'),c.req.query('usage_id'))}})})
