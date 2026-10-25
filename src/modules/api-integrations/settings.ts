import {machineInput,rotateMachine} from './machine-credentials'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {tokens,issuerGuard,SCOPES,type Issuer} from '../../platform/integration-authority'
import {saveDestination,disableDestination} from './destinations'
import {dispatchIntegrations} from './dispatch'
import {iso} from './http'
import {resendDelivery} from './resend'
import {requireStepUp} from '../identity/two-factor/step-up'
export const integrationSettings=new Hono<AppEnv>()
const root='/projects/:projectId/connections'
async function issuer(c:any):Promise<Issuer>{const actor=await scope(c,true);if(actor.role!=='owner'&&actor.role!=='admin')throw new HTTPException(403);return {actor:{...actor,role:actor.role},sessionHash:c.get('sessionHash')}}
async function audit(c:any,who:Issuer,action:string,resource='settings'){
 const guard=await issuerGuard(c.env,who)
 await c.env.DB.prepare(`INSERT INTO native_integration_audit SELECT ?,?,?,?,?,? WHERE EXISTS(${guard.sql})`).bind(crypto.randomUUID(),who.actor.projectId,who.actor.id,action,resource,Date.now(),...guard.params).run()
}
integrationSettings.get(root+'/tokens',async c=>{const who=await issuer(c),list=await tokens(c.env,who.actor.projectId).list(who);const metadata=await c.env.DB.prepare('SELECT id,source_product,bindings_json,issuer_id,display_prefix,create_minute,create_day FROM integration_tokens WHERE namespace=?').bind(who.actor.projectId).all<any>();const usage=await c.env.DB.prepare('SELECT token_id,max(at) last_used_at FROM integration_token_usage WHERE namespace=? AND allowed=1 GROUP BY token_id').bind(who.actor.projectId).all<any>();return c.json({scopes:SCOPES,data:list.map(row=>iso({...row,...metadata.results.find(m=>m.id===row.id),last_used_at:usage.results.find(u=>u.token_id===row.id)?.last_used_at??null}))})})
integrationSettings.post(root+'/tokens',async c=>{const who=await issuer(c),b=await c.req.json();await requireStepUp(c,who.actor,'integration.install');if(!Array.isArray(b.scopes)||!b.scopes.length||b.scopes.some((x:string)=>!(SCOPES as readonly string[]).includes(x)))throw new HTTPException(400,{message:'Select supported scopes'});const expiresAt=b.expires_at?Date.parse(b.expires_at):undefined;if(expiresAt!==undefined&&!Number.isSafeInteger(expiresAt))throw new HTTPException(400,{message:'Invalid expiry'});try{const created=await tokens(c.env,who.actor.projectId,b.source_product!==undefined||b.scopes.some((scope:string)=>['conversations:create','messages:append'].includes(scope))?machineInput(b):undefined).issue(who,{name:b.name,scopes:b.scopes,expiresAt});return c.json({token:created.token,data:iso(created.credential)},201)}catch(e){if(e instanceof HTTPException)throw e;throw new HTTPException(400,{message:'Token creation refused; verify the name, expiry and current authority'})}})
integrationSettings.patch(root+'/tokens/:id',async c=>{
 const who=await issuer(c);await requireStepUp(c,who.actor,'integration.install');const b=await c.req.json(),id=c.req.param('id')!,old=await c.env.DB.prepare('SELECT * FROM integration_tokens WHERE namespace=? AND id=? AND source_product IS NOT NULL').bind(who.actor.projectId,id).first<any>();if(!old)throw new HTTPException(404)
 if(Object.keys(b).some(key=>!['scopes','bindings','create_per_minute','create_per_day'].includes(key)))throw new HTTPException(400)
 const scopes=b.scopes??JSON.parse(old.scopes);if(!Array.isArray(scopes)||!scopes.length||scopes.some((value:string)=>!(SCOPES as readonly string[]).includes(value)))throw new HTTPException(400)
 const config=machineInput({source_product:old.source_product,bindings:b.bindings??JSON.parse(old.bindings_json),create_per_minute:b.create_per_minute??old.create_minute,create_per_day:b.create_per_day??old.create_day}),guard=await issuerGuard(c.env,who)
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`UPDATE integration_tokens SET scopes=?,bindings_json=?,create_minute=?,create_day=? WHERE namespace=? AND id=? AND EXISTS(${guard.sql})`).bind(JSON.stringify(scopes),config.bindings,config.minute,config.day,who.actor.projectId,id,...guard.params),
  c.env.DB.prepare(`INSERT INTO native_integration_audit SELECT ?,?,?,'token.bounds_changed',?,? WHERE EXISTS(${guard.sql})`).bind(crypto.randomUUID(),who.actor.projectId,who.actor.id,id,Date.now(),...guard.params)
 ]);if(!result[0].meta.changes)throw new HTTPException(409);return c.json({updated:true})
})
integrationSettings.post(root+'/tokens/:id/rotate',async c=>{const who=await issuer(c);await requireStepUp(c,who.actor,'integration.install');const result=await rotateMachine(c.env,who,c.req.param('id')!,await c.req.json());return c.json({token:result.token,data:iso(result.credential)},201)})
integrationSettings.delete(root+'/tokens/:id',async c=>{const who=await issuer(c),service=tokens(c.env,who.actor.projectId);await requireStepUp(c,who.actor,'integration.install');if(!(await service.list(who)).some(row=>row.id===c.req.param('id')!))throw new HTTPException(404,{message:'Not found'});return c.json(await service.revoke(who,c.req.param('id')!))})
integrationSettings.get(root+'/tokens/usage',async c=>{const who=await issuer(c);const rows=await tokens(c.env,who.actor.projectId).usage(who);return c.json({data:rows.map(row=>({...row,at:new Date(row.at).toISOString()}))})})
for(const kind of ['webhook','slack'] as const){
 const path=root+'/'+(kind==='webhook'?'webhooks':'slack')
 integrationSettings.get(path,async c=>{const who=await issuer(c);await audit(c,who,kind+'.list');const rows=await c.env.DB.prepare('SELECT id,name,mode,events_json,enabled,created_at FROM native_integration_destinations WHERE project_id=? AND kind=? ORDER BY created_at DESC,id').bind(who.actor.projectId,kind).all<any>();return c.json({data:rows.results.map(({events_json,...row})=>({...iso(row),events:JSON.parse(events_json)})),transport:'https-fetch'})})
 integrationSettings.post(path,async c=>{const who=await issuer(c);await requireStepUp(c,who.actor,'integration.install');return c.json(await saveDestination(c.env,who,kind,await c.req.json()),201)})
 integrationSettings.delete(path+'/:id',async c=>{const who=await issuer(c);if(!await c.env.DB.prepare('SELECT 1 FROM native_integration_destinations WHERE project_id=? AND id=? AND kind=?').bind(who.actor.projectId,c.req.param('id')!,kind).first())throw new HTTPException(404,{message:'Not found'});return c.json(await disableDestination(c.env,who,c.req.param('id')!))})
 integrationSettings.post(path+'/:id/test',async c=>{
  const who=await issuer(c),project=who.actor.projectId,id=c.req.param('id')!,guard=await issuerGuard(c.env,who),event=crypto.randomUUID(),intent=crypto.randomUUID(),now=Date.now()
  const result=await c.env.DB.batch([
   c.env.DB.prepare(`INSERT INTO native_integration_events(id,project_id,event,body,created_at) SELECT ?,?,'integration.test','{}',? WHERE EXISTS(SELECT 1 FROM native_integration_destinations WHERE id=? AND project_id=? AND kind=? AND enabled=1) AND EXISTS(${guard.sql})`).bind(event,project,now,id,project,kind,...guard.params),
   c.env.DB.prepare('INSERT INTO native_integration_intents(id,project_id,event_id,destination_id) SELECT ?,project_id,id,? FROM native_integration_events WHERE id=?').bind(intent,id,event),
   c.env.DB.prepare("INSERT INTO native_integration_audit SELECT ?,project_id,?,'destination.test',?,? FROM native_integration_events WHERE id=?").bind(crypto.randomUUID(),who.actor.id,id,now,event)
  ])
  if(!result[0].meta.changes)throw new HTTPException(404,{message:'Not found'})
  await dispatchIntegrations(c.env,project)
  return c.json({id:intent,state:'recorded',error:null},202)
 })
}
integrationSettings.post(root+'/deliveries/:id/resend',async c=>{const who=await issuer(c),input=await c.req.json();return c.json(await resendDelivery(c.env,who,c.req.param('id')!,input.attempt),202)})
integrationSettings.get(root+'/deliveries',async c=>{
 const who=await issuer(c);await audit(c,who,'deliveries.list')
 const rows=await c.env.DB.prepare(`SELECT i.id,i.destination_id,d.name,d.kind,v.attempts,e.event,e.created_at,i.error_code,coalesce(v.state,CASE WHEN i.error_code IS NULL THEN 'pending' ELSE 'blocked' END) state,a.number,a.started_at,a.finished_at,a.outcome FROM native_integration_intents i JOIN native_integration_events e ON e.id=i.event_id JOIN native_integration_destinations d ON d.id=i.destination_id LEFT JOIN integration_deliveries v ON v.namespace=i.project_id AND v.id=i.id LEFT JOIN integration_attempts a ON a.namespace=i.project_id AND a.delivery_id=i.id WHERE i.project_id=? ORDER BY e.created_at DESC,i.id,a.number LIMIT 200`).bind(who.actor.projectId).all<any>()
 return c.json({data:rows.results.map(({outcome,...row})=>{const result=outcome?JSON.parse(outcome):null;return {...iso(row),status:result?.status??null,error_class:result?.code??row.error_code,duration_ms:row.finished_at===null?null:row.finished_at-row.started_at}})})
})
