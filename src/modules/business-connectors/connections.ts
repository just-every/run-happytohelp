import {issuerGuard} from '../../platform/integration-authority'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {encryptToken} from '../integrations/secrets'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement,requestSource} from '../audit/record'
import {access,connection} from './access'
import {SCOPES,provider,text,id,cents,type Connection} from './model'
import {host,code} from './providers/http'
import {connectionFields} from './fields'
import {identity} from './providers/context'
export const root='/projects/:projectId'
export const connections=new Hono<AppEnv>()
export const publicConnection=({token_cipher,authority_epoch,...row}:Connection)=>({...row,connected:row.provider!=='orbit'&&!!token_cipher,unavailable_reason:row.provider==='orbit'?'Orbit scoped public API is not available':null,scopes:JSON.parse(row.scopes_json)})
connections.get(root+'/connections',async c=>{const {actor}=await access(c);const result=await c.env.DB.prepare('SELECT * FROM business_connections WHERE project_id=? ORDER BY provider,account').bind(actor.projectId).all<Connection>();return c.json({data:result.results.map(publicConnection)})})
connections.post(root+'/connections',async c=>{
 const {actor}=await access(c,'integrations.install');await requireStepUp(c,actor,'business.install')
 const body=await c.req.json(),p=provider(body.provider);if(p==='orbit')throw new HTTPException(409,{message:'Orbit connection is unavailable: the fleet CRM has not shipped its admin-issued scoped public API (run-orbit API-001). Browser sessions are not integration credentials.'});const account=id(body.account),origin=host(p,body.host),token=text(body.token,'credential',10000),limit=cents(body.limit_cents??0)
 if(!Array.isArray(body.scopes)||!body.scopes.includes('read')||body.scopes.some((s:string)=>!(SCOPES as readonly string[]).includes(s)))throw new HTTPException(400,{message:'Select explicit supported scopes including read'})
 const expires=body.expires_at==null?null:Number(body.expires_at);if(expires!==null&&(!Number.isSafeInteger(expires)||expires<=Date.now()))throw new HTTPException(400,{message:'Expiry must be in the future'})
 const fields=connectionFields(body.fields)
 const row:Connection={id:actor.projectId+':'+p+':'+account,project_id:actor.projectId,provider:p,account,host:origin,token_cipher:null,scopes_json:JSON.stringify([...new Set(body.scopes)]),fields_json:JSON.stringify(fields),limit_cents:limit,expires_at:expires,version:1,updated_at:Date.now()}
 try{if(String(await identity(row,token))!==account)throw Error('identity_mismatch')}catch(error){throw new HTTPException(409,{message:'Provider account verification failed: '+code(error)})}
 const cipher=await encryptToken(c.env,actor.projectId,token)
 const final=await access(c,'integrations.install');await requireStepUp(c,actor,'business.install');const authority=await issuerGuard(c.env,{actor,sessionHash:c.get('sessionHash')})
 const previous=await c.env.DB.prepare('SELECT host FROM business_connections WHERE id=?').bind(row.id).first<{host:string}>();if(previous&&previous.host!==origin)throw new HTTPException(409,{message:'A connected account cannot change provider origin'})
 const saved=await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO business_connections(id,project_id,provider,account,host,token_cipher,scopes_json,fields_json,limit_cents,expires_at,version,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,1,? WHERE EXISTS(${authority.sql}) AND (SELECT revision FROM integration_authority_epoch WHERE id=1)=? ON CONFLICT(id) DO UPDATE SET token_cipher=excluded.token_cipher,scopes_json=excluded.scopes_json,fields_json=excluded.fields_json,limit_cents=excluded.limit_cents,expires_at=excluded.expires_at,version=business_connections.version+1,updated_at=excluded.updated_at`).bind(row.id,actor.projectId,p,account,origin,cipher,row.scopes_json,row.fields_json,limit,expires,row.updated_at,...authority.params,final.epoch),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'business.connected',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'business_connection',id:row.id},detail:{provider:p,scopes:body.scopes,limit_cents:limit}})])
 if(!saved[0].meta.changes)throw new HTTPException(409,{message:'Workspace authority changed'})
 return c.json({data:publicConnection((await c.env.DB.prepare('SELECT * FROM business_connections WHERE id=?').bind(row.id).first<Connection>())!)},201)
})
connections.delete(root+'/connections/:connectionId',async c=>{
 const {actor,row}=await connection(c);await access(c,'integrations.install');const authority=await issuerGuard(c.env,{actor,sessionHash:c.get('sessionHash')})
 const saved=await c.env.DB.batch([c.env.DB.prepare(`UPDATE business_connections SET token_cipher=NULL,version=version+1,updated_at=? WHERE id=? AND project_id=? AND EXISTS(${authority.sql}) AND (SELECT revision FROM integration_authority_epoch WHERE id=1)=?`).bind(Date.now(),row.id,actor.projectId,...authority.params,row.authority_epoch!),c.env.DB.prepare("UPDATE business_links SET error='disconnected' WHERE connection_id=? AND project_id=?").bind(row.id,actor.projectId),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'business.disconnected',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'business_connection',id:row.id}})])
 if(!saved[0].meta.changes)throw new HTTPException(409,{message:'Workspace authority changed'})
 return c.json({disconnected:true})
})
