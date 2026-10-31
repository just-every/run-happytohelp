import {credentialById} from './credentials'
import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {validateDestination,resolveSlackWebhook,resolveSlackBot} from '../../vendor/base/modules/integrations/index.ts'
import {encryptToken,decryptToken} from '../integrations/secrets'
import {issuerGuard,type Issuer} from '../../platform/integration-authority'
export class DestinationUnavailable extends Error {}
export const EVENTS=['contact.created','contact.updated','article.published','conversation.status_changed','conversation.assigned','conversation.created','message.created','conversation.resolved','conversation.rated'] as const
export async function destination(env:Env,projectId:string,id:string){
 const row=await env.DB.prepare("SELECT d.* FROM native_integration_destinations d WHERE d.project_id=? AND d.id=? AND d.enabled=1 AND (d.credential_id IS NULL OR EXISTS(SELECT 1 FROM api_credentials c WHERE c.namespace=d.project_id AND c.id=d.credential_id AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>?) AND (d.connector<>'zapier' OR NOT EXISTS(SELECT 1 FROM json_each(d.events_json) ev WHERE NOT EXISTS(SELECT 1 FROM json_each(c.scopes) sc WHERE sc.value=CASE WHEN ev.value LIKE 'contact.%' THEN 'contacts:read' WHEN ev.value LIKE 'article.%' THEN 'articles:read' ELSE 'conversations:read' END))))) AND EXISTS(SELECT 1 FROM projects p WHERE p.id=d.project_id) AND NOT EXISTS(SELECT 1 FROM project_settings p WHERE p.project_id=d.project_id AND json_extract(p.settings_json,'$.deleted_at') IS NOT NULL)").bind(projectId,id,Date.now()).first<any>()
 if(!row)throw new DestinationUnavailable('Destination unavailable')
 try{return {...row,secret:JSON.parse(await decryptToken(env,projectId,row.secret_ciphertext))}}catch{throw new DestinationUnavailable('Destination unavailable')}
}
export async function saveDestination(env:Env,issuer:Issuer,kind:'webhook'|'slack',body:any){
 if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100)throw new HTTPException(400,{message:'Name must contain 1–100 characters'})
 let secret:any,mode:string|null=null,events:string[],shown:string|undefined
 try{
  if(kind==='webhook'){
   validateDestination(body.url);events=body.events
   if(!Array.isArray(events)||!events.length||events.some((e:string)=>!(EVENTS as readonly string[]).includes(e))||new Set(events).size!==events.length)throw Error()
   shown=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');secret={url:body.url,key:shown}
  }else{
   mode=body.mode;events=body.events??['conversation.created']
   if(!Array.isArray(events)||events.some((event:string)=>event!=='conversation.created')||events.length>1)throw Error()
   if(mode==='incoming-webhook'){await resolveSlackWebhook(async()=>body.url,'validation');secret={url:body.url}}
   else if(mode==='bot'){await resolveSlackBot(async()=>({token:body.token,channel:body.channel}),'validation');secret={token:body.token,channel:body.channel}}
   else throw Error()
  }
 }catch{throw new HTTPException(400,{message:kind==='webhook'?'Choose a public HTTPS URL and supported events':'Invalid Slack configuration'})}
 if(body.credential_id!==undefined){const credential=await credentialById(env,issuer.actor.projectId,body.credential_id);if(!credential)throw new HTTPException(404);body={...body,credential_id:credential.id}}
 if(body.source_product!==undefined&&(typeof body.source_product!=='string'||! /^[a-z][a-z0-9_-]{0,63}$/.test(body.source_product)))throw new HTTPException(400)
 const id=crypto.randomUUID(),now=Date.now(),cipher=await encryptToken(env,issuer.actor.projectId,JSON.stringify(secret)),guard=await issuerGuard(env,issuer)
 const results=await env.DB.batch([
  env.DB.prepare(`INSERT INTO native_integration_destinations(id,project_id,kind,name,mode,events_json,secret_ciphertext,created_at,credential_id,source_product) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(${guard.sql})`).bind(id,issuer.actor.projectId,kind,body.name.trim(),mode,JSON.stringify(events),cipher,now,body.credential_id??null,body.source_product??null,...guard.params),
  env.DB.prepare("INSERT INTO native_integration_audit SELECT ?,project_id,?,'destination.created',id,? FROM native_integration_destinations WHERE id=?").bind(crypto.randomUUID(),issuer.actor.id,now,id)
 ])
 if(!results[0].meta.changes)throw new HTTPException(409,{message:'Authority changed'})
 return {id,...(shown?{secret:shown}:{})}
}
export async function disableDestination(env:Env,issuer:Issuer,id:string){
 const guard=await issuerGuard(env,issuer),now=Date.now()
 const result=await env.DB.batch([
  env.DB.prepare(`UPDATE native_integration_destinations SET enabled=0 WHERE project_id=? AND id=? AND EXISTS(${guard.sql})`).bind(issuer.actor.projectId,id,...guard.params),
  env.DB.prepare(`INSERT INTO native_integration_audit SELECT ?,project_id,?,'destination.disabled',id,? FROM native_integration_destinations WHERE project_id=? AND id=? AND enabled=0 AND EXISTS(${guard.sql})`).bind(crypto.randomUUID(),issuer.actor.id,now,issuer.actor.projectId,id,...guard.params)
 ])
 if(!result[0].meta.changes)throw new HTTPException(404,{message:'Not found'})
 return {disabled:true}
}
