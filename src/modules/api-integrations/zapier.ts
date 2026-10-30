import type {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import {validateDestination} from '../../vendor/base/modules/integrations/index.ts'
import {encryptToken} from '../integrations/secrets'
import {tokenGuard,type ApiScope} from '../../platform/integration-authority'
import {EVENTS} from './destinations'
import {authorized,bearerScopes} from './managed'
import {jsonBody,type ApiEnv} from './http'
export const eventScope=(event:string):ApiScope=>event.startsWith('contact.')?'contacts:read':event.startsWith('article.')?'articles:read':'conversations:read'
export function zapierApi(app:Hono<ApiEnv>){
 app.post('/zapier/hooks',async c=>{
  const b=await jsonBody(c)
  if(!(EVENTS as readonly string[]).includes(b.event))throw new HTTPException(400,{message:'Unsupported event'})
  try{validateDestination(b.url)}catch{throw new HTTPException(400,{message:'Public HTTPS hook URL required'})}
  return authorized(c,eventScope(b.event),async a=>{
   const id=crypto.randomUUID(),key=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join(''),guard=tokenGuard(a,a.projectId,eventScope(b.event))
   const cipher=await encryptToken(c.env,a.projectId,JSON.stringify({url:b.url,key}))
   const result=await c.env.DB.prepare(`INSERT INTO native_integration_destinations(id,project_id,kind,name,events_json,secret_ciphertext,created_at,credential_id,connector) SELECT ?,?,'webhook','Zapier hook',?,?,?,?, 'zapier' WHERE EXISTS(${guard.sql})`).bind(id,a.projectId,JSON.stringify([b.event]),cipher,Date.now(),a.credentialId,...guard.params).run()
   if(!result.meta.changes)throw new HTTPException(409)
   return c.json({id,secret:key,event:b.event,project_id:a.projectId},201)
  })
 })
 app.delete('/zapier/hooks/:hookId',async c=>{
  // Authenticate before looking up a hook; foreign IDs never disclose scope or tenant.
  const scopes=await bearerScopes(c)
  return authorized(c,scopes[0]??'conversations:read',async a=>{
   const row=await c.env.DB.prepare("SELECT events_json FROM native_integration_destinations WHERE id=? AND project_id=? AND credential_id=? AND connector='zapier'").bind(c.req.param('hookId'),a.projectId,a.credentialId).first<any>()
   if(!row)throw new HTTPException(404)
   return authorized(c,eventScope(JSON.parse(row.events_json)[0]),async current=>{
    const guard=tokenGuard(current,current.projectId,current.scope)
    const result=await c.env.DB.prepare(`UPDATE native_integration_destinations SET enabled=0 WHERE id=? AND project_id=? AND credential_id=? AND EXISTS(${guard.sql})`).bind(c.req.param('hookId'),current.projectId,current.credentialId,...guard.params).run()
    if(!result.meta.changes)throw new HTTPException(409)
    return c.json({disabled:true})
   })
  })
 })
 app.get('/zapier/sample',async c=>{
  const event=c.req.query('event')??'conversation.created'
  if(!(EVENTS as readonly string[]).includes(event))throw new HTTPException(400)
  const resource=event.startsWith('contact.')?'contacts':event.startsWith('article.')?'articles':'conversations'
  return app.fetch(new Request('https://managed.internal/'+resource+'?limit=5',{headers:{Authorization:c.req.header('Authorization')??''}}),c.env,c.executionCtx)
 })
}
