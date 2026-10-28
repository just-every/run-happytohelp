import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env} from '../../platform/env'
import {encryptToken,decryptToken} from '../integrations/secrets'
import {memberAccess} from '../access/gate'
import {teamsTarget} from './providers/teams'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement,requestSource} from '../audit/record'
import {escalationAccess,string,requestBody} from './access'
import type {Connection,Provider} from './providers'
export const prefix='/projects/:projectId'
export interface ConnectionRow {id:string;project_id:string;provider:Provider;target:string;base_url:string|null;token_cipher:string|null;webhook_cipher:string|null;installed_by:string|null}
const connectionTable=(p:Provider)=>p==='teams'?'escalation_teams_connections':'escalation_connections'
export async function loadConnection(env:Env,projectId:string,provider:Provider){
 const row=await env.DB.prepare(`SELECT * FROM ${connectionTable(provider)} WHERE project_id=? AND provider=?`).bind(projectId,provider).first<ConnectionRow>()
 if(!row?.token_cipher)throw new HTTPException(409,{message:'Connect this provider in this workspace first'})
 if(provider==='teams'){const access=row.installed_by?await memberAccess(env.DB,projectId,row.installed_by):null;if(!access?.permissions.has('integrations.install')||!['owner','admin'].includes(access.base))throw new HTTPException(403,{message:'Teams installation authority was revoked. An administrator must reconnect.'})}
 const connection:Connection={provider:row.provider,target:row.target,baseUrl:row.base_url??undefined,token:await decryptToken(env,projectId,row.token_cipher)}
 return {row,connection}
}
export function provider(value:unknown):Provider{if(!['github','linear','jira','slack','teams'].includes(String(value)))throw new HTTPException(400,{message:'Choose a supported provider'});return value as Provider}
function baseUrl(value:unknown,p:Provider){
 if(value===undefined||value==='')return p==='jira'?string(value,'Jira site URL'):null
 let url:URL;try{url=new URL(string(value,'provider URL'))}catch{throw new HTTPException(400,{message:'Invalid provider URL'})}
 const local=url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)
 const hosts:Record<Provider,string>={github:'api.github.com',linear:'api.linear.app',slack:'slack.com',teams:'graph.microsoft.com',jira:''}
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||(!local&&(url.protocol!=='https:'||url.port||!(p==='jira'?/^[a-z0-9-]+\.atlassian\.net$/.test(url.hostname):url.hostname===hosts[p]))))throw new HTTPException(400,{message:'Use the provider’s own HTTPS host or a local provider server'})
 return url.href.replace(/\/$/,'')
}
export const connectionRoutes=new Hono<AppEnv>()
connectionRoutes.get(prefix+'/connections',async c=>{const {actor}=await escalationAccess(c);const rows=await c.env.DB.prepare('SELECT id,provider,target,base_url,token_cipher IS NOT NULL connected FROM escalation_connections WHERE project_id=? UNION ALL SELECT id,provider,target,base_url,token_cipher IS NOT NULL connected FROM escalation_teams_connections WHERE project_id=? ORDER BY provider').bind(actor.projectId,actor.projectId).all();return c.json({data:rows.results.map(row=>({...row,connected:!!row.connected,webhook_url:['slack','teams'].includes(String(row.provider))?undefined:new URL(`/api/escalations/webhooks/${row.id}`,c.req.url).href}))})})
connectionRoutes.post(prefix+'/connections',async c=>{
 const {actor}=await escalationAccess(c,'integrations.install'),body=await requestBody(c);await requireStepUp(c,actor,'escalations.install')
 const p=provider(body.provider),url=baseUrl(body.base_url,p)
 let target=string(body.target,'provider target',200)
 if(p==='teams')target=target.replace(/\s*\/\s*/,'/')
 if(p==='github'&&!/^[\w.-]+\/[\w.-]+$/.test(target)||p==='slack'&&!/^[CG][A-Z0-9]+$/.test(target))throw new HTTPException(400,{message:'Invalid repository or channel'})
 if(p==='teams'){const access=await memberAccess(c.env.DB,actor.projectId,actor.id);if(!access||!['owner','admin'].includes(access.base))throw new HTTPException(403,{message:'Only a workspace administrator can install Teams'});try{teamsTarget(target)}catch{throw new HTTPException(400,{message:'Use the Teams team UUID followed by its channel ID, separated by a slash'})}}
 const rawToken=string(body.token,'token',10000),token=p==='jira'&&body.email?'Basic '+btoa(string(body.email,'Jira email',320)+':'+rawToken):rawToken
 const secret=['slack','teams'].includes(p)?null:await encryptToken(c.env,actor.projectId,string(body.webhook_secret,'webhook secret',1000))
 const id=actor.projectId+':'+p,now=Date.now(),cipher=await encryptToken(c.env,actor.projectId,token)
 const previous=await c.env.DB.prepare(`SELECT target,base_url FROM ${connectionTable(p)} AS connection WHERE id=? AND (EXISTS(SELECT 1 FROM escalation_issues WHERE connection_id=?) OR EXISTS(SELECT 1 FROM escalation_operations WHERE project_id=connection.project_id AND provider=connection.provider))`).bind(id,id).first<{target:string;base_url:string|null}>()
 if(previous&&(previous.target!==target||previous.base_url!==url))throw new HTTPException(409,{message:'This connection already has linked issues. Keep its repository, team or project and API host when rotating credentials.'})
 await escalationAccess(c,'integrations.install')
 await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO ${connectionTable(p)}(id,project_id,provider,target,base_url,token_cipher,webhook_cipher,updated_at,installed_by) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,provider) DO UPDATE SET target=excluded.target,base_url=excluded.base_url,token_cipher=excluded.token_cipher,webhook_cipher=excluded.webhook_cipher,updated_at=excluded.updated_at,installed_by=excluded.installed_by`).bind(id,actor.projectId,p,target,url,cipher,secret,now,actor.id),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'escalation.connected',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'escalation_connection',id},detail:{provider:p}})])
 return c.json({data:{id,provider:p,target,base_url:url,connected:true,webhook_url:['slack','teams'].includes(p)?undefined:new URL(`/api/escalations/webhooks/${id}`,c.req.url).href}},201)
})
