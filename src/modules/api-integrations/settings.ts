import {credentialById,credentialBindings,resolveBindings} from './credentials'
import {machineInput,rotateMachine} from './machine-credentials'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {tokens,issuerGuard,credentialScopes,SCOPES,type Issuer} from '../../platform/integration-authority'
import {saveDestination,disableDestination} from './destinations'
import {dispatchIntegrations} from './dispatch'
import {iso,jsonBody} from './http'
import {resendDelivery} from './resend'
import {requireStepUp} from '../identity/two-factor/step-up'
export const integrationSettings=new Hono<AppEnv>()
const root='/projects/:projectId/connections'
async function issuer(c:any):Promise<Issuer>{const actor=await scope(c,true);if(actor.role!=='owner'&&actor.role!=='admin')throw new HTTPException(403);return {actor:{...actor,role:actor.role},sessionHash:c.get('sessionHash')}}
async function audit(c:any,who:Issuer,action:string,resource='settings'){
 const guard=await issuerGuard(c.env,who)
 await c.env.DB.prepare(`INSERT INTO native_integration_audit SELECT ?,?,?,?,?,? WHERE EXISTS(${guard.sql})`).bind(crypto.randomUUID(),who.actor.projectId,who.actor.id,action,resource,Date.now(),...guard.params).run()
}
integrationSettings.get(root+'/tokens',async c=>{
 const who=await issuer(c),p=who.actor.projectId;await audit(c,who,'token.list','tokens')
 const rows=await c.env.DB.prepare('SELECT c.*,u.name issuer_name FROM api_credentials c LEFT JOIN users u ON u.id=c.issuer_id WHERE c.namespace=? ORDER BY c.created_at,c.id').bind(p).all<any>()
 const secrets=await c.env.DB.prepare('SELECT t.id,t.credential_id,t.display_prefix,t.expires_at,t.revoked_at,max(u.at) last_used_at FROM integration_tokens t LEFT JOIN integration_token_usage u ON u.namespace=t.namespace AND u.token_id=t.id AND u.allowed=1 WHERE t.namespace=? GROUP BY t.id').bind(p).all<any>()
 return c.json({scopes:SCOPES,data:rows.results.map(row=>{const children=secrets.results.filter(t=>t.credential_id===row.id);return iso({...row,scopes:JSON.parse(row.scopes),bindings_json:JSON.stringify(credentialBindings(row)),createdAt:row.created_at,expiresAt:row.expires_at,revokedAt:row.revoked_at,display_prefix:children[0]?.display_prefix,last_used_at:Math.max(...children.map(t=>t.last_used_at??0))||null,secrets:children.map(iso)})})})
})
integrationSettings.post(root+'/tokens',async c=>{const who=await issuer(c),b=await resolveBindings(c.env,who.actor.projectId,await jsonBody(c));await requireStepUp(c,who.actor,'integration.install');b.scopes=credentialScopes(b.scopes,b.source_product);const expiresAt=b.expires_at?Date.parse(b.expires_at):undefined;if(expiresAt!==undefined&&!Number.isSafeInteger(expiresAt))throw new HTTPException(400,{message:'Invalid expiry'});try{const created=await tokens(c.env,who.actor.projectId,b.source_product!==undefined||b.scopes.some((scope:string)=>['conversations:create','messages:append'].includes(scope))?machineInput(b):undefined).issue(who,{name:b.name,scopes:b.scopes,expiresAt});return c.json({token:created.token,data:iso(created.credential)},201)}catch(e){if(e instanceof HTTPException)throw e;throw new HTTPException(400,{message:'Token creation refused; verify the name, expiry and current authority'})}})
integrationSettings.patch(root+'/tokens/:id',async c=>{
 const who=await issuer(c);await requireStepUp(c,who.actor,'integration.install');const b=await jsonBody(c),id=c.req.param('id')!,old=await credentialById(c.env,who.actor.projectId,id);if(!old)throw new HTTPException(404)
 if(Object.keys(b).some(key=>!['scopes','bindings','create_per_minute','create_per_day'].includes(key)))throw new HTTPException(400)
 const scopes=credentialScopes(b.scopes??JSON.parse(old.scopes),old.source_product)
 const config=old.source_product===null?{reach:'{}',values:'{}',minute:old.create_minute,day:old.create_day}:machineInput(await resolveBindings(c.env,who.actor.projectId,{source_product:old.source_product,scopes,bindings:b.bindings??credentialBindings(old),create_per_minute:b.create_per_minute??old.create_minute,create_per_day:b.create_per_day??old.create_day})),guard=await issuerGuard(c.env,who)
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`UPDATE api_credentials SET scopes=?,reach_json=?,values_json=?,create_minute=?,create_day=? WHERE namespace=? AND id=? AND EXISTS(${guard.sql})`).bind(JSON.stringify([...new Set(scopes)].sort()),config.reach,config.values,config.minute,config.day,who.actor.projectId,old.id,...guard.params),
  c.env.DB.prepare(`INSERT INTO native_integration_audit SELECT ?,?,?,'token.bounds_changed',?,? WHERE EXISTS(${guard.sql})`).bind(crypto.randomUUID(),who.actor.projectId,who.actor.id,old.id,Date.now(),...guard.params)
 ]);if(!result[0].meta.changes)throw new HTTPException(409);return c.json({updated:true})
})
integrationSettings.post(root+'/tokens/:id/rotate',async c=>{const who=await issuer(c);await requireStepUp(c,who.actor,'integration.install');const result=await rotateMachine(c.env,who,c.req.param('id')!,await jsonBody(c));return c.json({token:result.token,data:iso(result.credential)},201)})
integrationSettings.delete(root+'/tokens/:id',async c=>{
 const who=await issuer(c);await requireStepUp(c,who.actor,'integration.install');const credential=await credentialById(c.env,who.actor.projectId,c.req.param('id')!)
 if(!credential)throw new HTTPException(404)
 const secret=await c.env.DB.prepare('SELECT id FROM integration_tokens WHERE namespace=? AND credential_id=? ORDER BY created_at LIMIT 1').bind(who.actor.projectId,credential.id).first<{id:string}>()
 if(!secret)throw new HTTPException(409)
 return c.json(await tokens(c.env,who.actor.projectId).revoke(who,secret.id))
})
integrationSettings.get(root+'/tokens/usage',async c=>{const who=await issuer(c);await audit(c,who,'token.usage','tokens');const rows=await c.env.DB.prepare('SELECT u.*,t.credential_id FROM integration_token_usage u LEFT JOIN integration_tokens t ON t.namespace=u.namespace AND t.id=u.token_id WHERE u.namespace=? ORDER BY u.at,u.id').bind(who.actor.projectId).all<any>();return c.json({data:rows.results.map(row=>({id:row.id,tokenId:row.credential_id,credential_id:row.credential_id,at:new Date(row.at).toISOString(),requiredScopes:JSON.parse(row.required_scopes),allowed:row.allowed===1,requestId:row.request_id,resource:row.resource}))})})
for(const kind of ['webhook','slack'] as const){
 const path=root+'/'+(kind==='webhook'?'webhooks':'slack')
 integrationSettings.get(path,async c=>{const who=await issuer(c);await audit(c,who,kind+'.list');const rows=await c.env.DB.prepare('SELECT id,name,mode,events_json,enabled,created_at FROM native_integration_destinations WHERE project_id=? AND kind=? ORDER BY created_at DESC,id').bind(who.actor.projectId,kind).all<any>();return c.json({data:rows.results.map(({events_json,...row})=>({...iso(row),events:JSON.parse(events_json)})),transport:'https-fetch'})})
 integrationSettings.post(path,async c=>{const who=await issuer(c);await requireStepUp(c,who.actor,'integration.install');return c.json(await saveDestination(c.env,who,kind,await jsonBody(c)),201)})
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
integrationSettings.post(root+'/deliveries/:id/resend',async c=>{const who=await issuer(c),input=await jsonBody(c);return c.json(await resendDelivery(c.env,who,c.req.param('id')!,input.attempt),202)})
integrationSettings.get(root+'/deliveries',async c=>{
 const who=await issuer(c);await audit(c,who,'deliveries.list')
 const rows=await c.env.DB.prepare(`SELECT i.id,i.destination_id,d.name,d.kind,v.attempts,e.event,e.created_at,i.error_code,coalesce(v.state,CASE WHEN i.error_code IS NULL THEN 'pending' ELSE 'blocked' END) state,a.number,a.started_at,a.finished_at,a.outcome FROM native_integration_intents i JOIN native_integration_events e ON e.id=i.event_id JOIN native_integration_destinations d ON d.id=i.destination_id LEFT JOIN integration_deliveries v ON v.namespace=i.project_id AND v.id=i.id LEFT JOIN integration_attempts a ON a.namespace=i.project_id AND a.delivery_id=i.id WHERE i.project_id=? ORDER BY e.created_at DESC,i.id,a.number LIMIT 200`).bind(who.actor.projectId).all<any>()
 return c.json({data:rows.results.map(({outcome,...row})=>{const result=outcome?JSON.parse(outcome):null;return {...iso(row),status:result?.status??null,error_class:result?.code??row.error_code,duration_ms:row.finished_at===null?null:row.finished_at-row.started_at}})})
})
