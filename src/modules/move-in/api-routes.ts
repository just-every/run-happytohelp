import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import type {Run,Vendor} from './types'
import {importActor,runView} from './routes'
import {guarded} from './context'
import {getRun,updateRun} from './run-store'
import {enqueue} from './service'
import {apiRun,connection,saveCredential,startApiRun,type Connection} from './api-store'
import {credentials,providerBase,vendorHttp,probe,VendorError} from './api-http'
import {auditStatement,requestSource} from '../audit/record'
export const apiRoutes=new Hono<AppEnv>()
const root='/projects/:projectId/import-connections',imports='/projects/:projectId/imports'
apiRoutes.onError((error,c)=>{if(error instanceof VendorError)return c.json({error:error.message},error.status===401?401:error.status===403?403:error.status===429?429:502);if(error instanceof HTTPException)return error.getResponse();return c.json({error:'The move-in operation could not finish. Its saved checkpoint was kept.'},409)})
apiRoutes.post(root,async c=>{
 const actor=await importActor(c),body=await c.req.json(),vendor=body.vendor as Vendor
 if(!['zendesk','intercom','helpscout','freshdesk'].includes(vendor))throw new HTTPException(400,{message:'Choose a supported help desk'})
 const value=credentials(vendor,body),base=providerBase(c.env,vendor,body.domain),client=vendorHttp(c.env,vendor,base,value)
 await probe(vendor,client)
 const id=crypto.randomUUID(),now=Date.now(),row:Connection={id,project_id:actor.project_id,vendor,base_url:base,created_by:actor.actor_id,watermark:null,cutover_at:null,retry_at:null}
 await guarded(c.env,actor as Run,[c.env.DB.prepare('INSERT INTO move_in_connections(id,project_id,vendor,base_url,created_by,created_at) VALUES(?,?,?,?,?,?)').bind(id,actor.project_id,vendor,base,actor.actor_id,now),await saveCredential(c.env,row,value),auditStatement(c.env.DB,{projectId:actor.project_id,category:'integration',action:'import.connected',actor:{type:'user',id:actor.actor_id},source:requestSource(c),target:{type:'import_connection',id},detail:{vendor}})])
 const runId=await startApiRun(c.env,row,actor,'initial'),run=(await getRun(c.env,runId))!;await enqueue(c.env,run);return c.json({data:await runView(c.env,run)},201)
})
apiRoutes.post(`${root}/:connectionId/sync`,async c=>{
 const actor=await importActor(c),row=await connection(c.env,c.req.param('connectionId'));if(!row||row.project_id!==actor.project_id||row.created_by!==actor.actor_id)throw new HTTPException(404)
 if(row.watermark===null)throw new HTTPException(409,{message:'Complete the first import before final sync'})
 if(row.cutover_at)throw new HTTPException(409,{message:'Cutover is already complete. This connection is a move-in, not a live sync.'})
 const id=await startApiRun(c.env,row,actor,'delta'),run=(await getRun(c.env,id))!;await enqueue(c.env,run);await auditStatement(c.env.DB,{projectId:actor.project_id,category:'data',action:'import.final_sync',actor:{type:'user',id:actor.actor_id},source:requestSource(c),target:{type:'import',id},detail:{vendor:row.vendor}}).run();return c.json({data:await runView(c.env,run)},202)
})
apiRoutes.post(`${imports}/:runId/agents`,async c=>{
 const actor=await importActor(c),run=await getRun(c.env,c.req.param('runId'));if(!run||run.project_id!==actor.project_id||run.actor_id!==actor.actor_id||!await apiRun(c.env,run.id))throw new HTTPException(404)
 if(run.state!=='ready')throw new HTTPException(409,{message:'Change agent matches while reviewing the import'})
 const body=await c.req.json(),mapping=body.mapping;if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))throw new HTTPException(400,{message:'Choose workspace members for the source agents'})
 const statements:D1PreparedStatement[]=[]
 for(const [source,member] of Object.entries(mapping)){
  if(!await c.env.DB.prepare('SELECT 1 FROM move_in_api_agents WHERE run_id=? AND source_id=?').bind(run.id,source).first())throw new HTTPException(400,{message:'The source agent is not in this review'})
  if(member!==null&&(typeof member!=='string'||!await c.env.DB.prepare('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?').bind(actor.project_id,member).first()))throw new HTTPException(400,{message:'Map agents to current workspace members, or keep them as source authors'})
  statements.push(c.env.DB.prepare('UPDATE move_in_api_agents SET member_id=? WHERE run_id=? AND source_id=?').bind(member,run.id,source))
 }
 statements.push(auditStatement(c.env.DB,{projectId:actor.project_id,category:'assignment',action:'import.agents_reviewed',actor:{type:'user',id:actor.actor_id},source:requestSource(c),target:{type:'import',id:run.id},detail:{agents:Object.keys(mapping).length,active:false}}))
 await updateRun(c.env,{...run,...actor},{state:'planning',cursor:0,error:null,plan_json:null,review_fingerprint:null},statements);const updated=(await getRun(c.env,run.id))!;await enqueue(c.env,updated);return c.json({data:await runView(c.env,updated)},202)
})
apiRoutes.post(`${imports}/:runId/cutover`,async c=>{
 const actor=await importActor(c),run=await getRun(c.env,c.req.param('runId'));if(!run||run.project_id!==actor.project_id||run.actor_id!==actor.actor_id)throw new HTTPException(404)
 const api=await apiRun(c.env,run.id),body=await c.req.json();if(!api||api.mode!=='delta'||run.state!=='completed'||body.confirmed!==true)throw new HTTPException(409,{message:'Complete and review a final sync, then confirm the channel checklist'})
 const conn=await connection(c.env,api.connection_id);if(conn?.cutover_at)return c.json({data:await runView(c.env,run),writes:0})
 if(await c.env.DB.prepare("SELECT 1 FROM move_in_api_runs a JOIN move_in_runs r ON r.id=a.run_id WHERE a.connection_id=? AND (r.state NOT IN ('completed','undone','erased') OR a.watermark>?) LIMIT 1").bind(api.connection_id,api.watermark).first())throw new HTTPException(409,{message:'Finish the newest final sync before cutover'})
 const now=Date.now(),scope="SELECT m.conversation_id FROM move_in_assignment m JOIN conversations c ON c.id=m.conversation_id WHERE m.project_id=?1 AND m.vendor=?2 AND EXISTS(SELECT 1 FROM move_in_api_runs a JOIN move_in_runs r ON r.id=a.run_id JOIN ik_provenance p ON p.job_id IN (SELECT b.kit_job_id FROM move_in_batches b WHERE b.run_id=r.id) WHERE a.connection_id=?3 AND r.state='completed' AND p.target_id=c.id AND p.target_kind='conversation' AND p.reversed=0)"
 await guarded(c.env,{...run,...actor},[
  c.env.DB.prepare(`INSERT OR IGNORE INTO move_in_native_fences(project_id,conversation_id) SELECT ?1,conversation_id FROM move_in_assignment WHERE conversation_id IN (${scope})`).bind(run.project_id,run.vendor,api.connection_id),
  c.env.DB.prepare(`UPDATE conversations SET assigned_to=(SELECT m.member_id FROM move_in_assignment m WHERE m.conversation_id=conversations.id AND EXISTS(SELECT 1 FROM memberships members WHERE members.project_id=m.project_id AND members.user_id=m.member_id)) WHERE id IN (${scope})`).bind(run.project_id,run.vendor,api.connection_id),
  c.env.DB.prepare(`DELETE FROM move_in_native_fences WHERE project_id=?1 AND conversation_id IN (${scope})`).bind(run.project_id,run.vendor,api.connection_id),
  c.env.DB.prepare('UPDATE move_in_connections SET cutover_at=? WHERE id=?').bind(now,api.connection_id),c.env.DB.prepare('UPDATE move_in_api_runs SET cutover_at=? WHERE run_id=?').bind(now,run.id),
  auditStatement(c.env.DB,{projectId:actor.project_id,category:'assignment',action:'import.cutover',actor:{type:'user',id:actor.actor_id},source:requestSource(c),target:{type:'import',id:run.id},detail:{vendor:run.vendor,notifications:false}})
 ]);return c.json({data:await runView(c.env,(await getRun(c.env,run.id))!)})
})
