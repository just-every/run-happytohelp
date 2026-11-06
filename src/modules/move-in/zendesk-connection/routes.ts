import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Context} from 'hono'
import type {AppEnv} from '../../../platform/env'
import {hashToken,requireActor} from '../../../platform/auth'
import {auditStatement,requestSource} from '../../audit/record'
import {decryptToken,encryptToken} from '../../integrations/secrets'
import {importActor} from '../routes'
import {ZendeskError} from './errors'
import {CLIENT_ID,SUBDOMAIN} from './http'
import {authorizationUrl,exchangeCode,revokeRemote} from './oauth'
import {codeChallenge,randomToken} from './pkce'
import {getConnection,publicConnection,sealedGrant,subdomainConflict} from './store'

export const CALLBACK_PATH='/api/move-in/zendesk/callback'
const AUTHORIZATION_MS=10*60*1000
const redirectUri=(c:Context<AppEnv>)=>new URL(CALLBACK_PATH,String(c.env.APP_ORIGIN||new URL(c.req.url).origin)).href
const conflictMessage=(bound:string)=>`This workspace already holds Zendesk history from ${bound}.zendesk.com. Connect ${bound} again, or use another workspace for a different Zendesk account.`
export const zendeskConnectionRoutes=new Hono<AppEnv>()

zendeskConnectionRoutes.post('/projects/:projectId/zendesk/connect',async c=>{
 const actor=await importActor(c),body=await c.req.json().catch(()=>({})) as {subdomain?:unknown;clientId?:unknown}
 const subdomain=typeof body.subdomain==='string'?body.subdomain.trim().toLowerCase():'',clientId=typeof body.clientId==='string'?body.clientId.trim():''
 if(!SUBDOMAIN.test(subdomain))throw new HTTPException(400,{message:'Enter only the first part of your Zendesk address, for example acme for acme.zendesk.com.'})
 if(!CLIENT_ID.test(clientId))throw new HTTPException(400,{message:'Enter the OAuth client’s Identifier from Zendesk Admin Center.'})
 const bound=await subdomainConflict(c.env,actor.project_id,subdomain);if(bound)throw new HTTPException(409,{message:conflictMessage(bound)})
 const state=randomToken(),verifier=randomToken(),uri=redirectUri(c)
 await c.env.DB.batch([
  c.env.DB.prepare('DELETE FROM move_in_zendesk_authorizations WHERE project_id=? AND (actor_id=? OR expires_at<?)').bind(actor.project_id,actor.actor_id,Date.now()),
  c.env.DB.prepare('INSERT INTO move_in_zendesk_authorizations(state_hash,project_id,actor_id,session_hash,subdomain,client_id,verifier_ciphertext,redirect_uri,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(await hashToken(state),actor.project_id,actor.actor_id,actor.session_hash,subdomain,clientId,await encryptToken(c.env,actor.project_id,verifier),uri,Date.now()+AUTHORIZATION_MS)])
 return c.json({url:authorizationUrl(subdomain,clientId,uri,state,await codeChallenge(verifier))})
})

/** Zendesk returns the browser here. The state is single use and bound to the
 * session and workspace that chose Connect; the code is exchanged with its verifier. */
zendeskConnectionRoutes.get('/zendesk/callback',async c=>{
 const state=c.req.query('state');if(!state)throw new HTTPException(400,{message:'This Zendesk sign-in is missing its state. Choose Connect again.'})
 const stateHash=await hashToken(state),row=await c.env.DB.prepare('SELECT * FROM move_in_zendesk_authorizations WHERE state_hash=?').bind(stateHash).first<any>()
 if(!row)throw new HTTPException(403,{message:'This Zendesk sign-in is not valid or was already used. Choose Connect again.'})
 const actor=await requireActor(c),token=c.req.header('Authorization')?.replace(/^Bearer /,'')||c.req.header('Cookie')?.match(/(?:^|;\s*)h2h_session=([^;]+)/)?.[1]
 const member=await c.env.DB.prepare("SELECT 1 FROM memberships WHERE project_id=? AND user_id=? AND role IN ('owner','admin')").bind(row.project_id,actor.id).first()
 if(actor.id!==row.actor_id||!token||await hashToken(token)!==row.session_hash||!member)throw new HTTPException(403,{message:'Finish connecting Zendesk in the same signed-in session that chose Connect.'})
 const consumed=await c.env.DB.prepare('DELETE FROM move_in_zendesk_authorizations WHERE state_hash=?').bind(stateHash).run()
 if(!consumed.meta.changes)throw new HTTPException(409,{message:'This Zendesk sign-in was already used. Choose Connect again.'})
 const done=(outcome:string)=>c.redirect(`/projects/${encodeURIComponent(row.project_id)}/move-in?zendesk=${outcome}`)
 if(row.expires_at<Date.now())return done('expired')
 if(c.req.query('error'))return done('denied')
 const code=c.req.query('code');if(!code)return done('failed')
 const record=(outcome:'succeeded'|'refused'|'failed',detail:Record<string,unknown>)=>auditStatement(c.env.DB,{projectId:row.project_id,category:'integration',action:'move_in.zendesk.connected',outcome,actor:{type:'user',id:actor.id},source:requestSource(c),detail:{subdomain:row.subdomain,...detail}}).run()
 let grant
 try{grant=await exchangeCode(row.subdomain,row.client_id,code,row.redirect_uri,await decryptToken(c.env,row.project_id,row.verifier_ciphertext))}
 catch(error){if(!(error instanceof ZendeskError))throw error;await record('failed',{reason:error.code,status:error.status??null});return done('failed')}
 if(await subdomainConflict(c.env,row.project_id,row.subdomain)){await record('refused',{reason:'zendesk_subdomain_bound'});return done('conflict')}
 const now=Date.now(),sealed=await sealedGrant(c.env,row.project_id,grant,now),scopes=typeof grant.scope==='string'&&grant.scope.trim()?grant.scope.trim():'read hc:read'
 await c.env.DB.batch([
  c.env.DB.prepare("INSERT INTO move_in_zendesk_connections(project_id,subdomain,client_id,scopes,state,access_ciphertext,refresh_ciphertext,access_expires_at,refresh_expires_at,generation,connected_by,connected_at,updated_at) VALUES(?,?,?,?,'connected',?,?,?,?,1,?,?,?) ON CONFLICT(project_id) DO UPDATE SET subdomain=excluded.subdomain,client_id=excluded.client_id,scopes=excluded.scopes,state='connected',access_ciphertext=excluded.access_ciphertext,refresh_ciphertext=excluded.refresh_ciphertext,access_expires_at=excluded.access_expires_at,refresh_expires_at=excluded.refresh_expires_at,generation=move_in_zendesk_connections.generation+1,connected_by=excluded.connected_by,connected_at=excluded.connected_at,updated_at=excluded.updated_at").bind(row.project_id,row.subdomain,row.client_id,scopes,sealed.access,sealed.refresh,sealed.accessExpiresAt,sealed.refreshExpiresAt,actor.id,now,now),
  auditStatement(c.env.DB,{projectId:row.project_id,category:'integration',action:'move_in.zendesk.connected',actor:{type:'user',id:actor.id},source:requestSource(c),detail:{subdomain:row.subdomain,scopes}})])
 return done('connected')
})

zendeskConnectionRoutes.get('/projects/:projectId/zendesk/connection',async c=>{const actor=await importActor(c);return c.json(publicConnection(await getConnection(c.env,actor.project_id)))})

zendeskConnectionRoutes.delete('/projects/:projectId/zendesk/connection',async c=>{
 const actor=await importActor(c),row=await getConnection(c.env,actor.project_id)
 if(!row)return c.json({disconnected:true,revoke:{outcome:'not_held'}})
 const revoke=await revokeRemote(c.env,row)
 await c.env.DB.batch([
  c.env.DB.prepare("UPDATE move_in_zendesk_connections SET state='disconnected',access_ciphertext=NULL,refresh_ciphertext=NULL,access_expires_at=NULL,refresh_expires_at=NULL,generation=generation+1,updated_at=? WHERE project_id=?").bind(Date.now(),actor.project_id),
  auditStatement(c.env.DB,{projectId:actor.project_id,category:'integration',action:'move_in.zendesk.disconnected',actor:{type:'user',id:actor.actor_id},source:requestSource(c),detail:{subdomain:row.subdomain,revoke:revoke.outcome,status:revoke.status??null}})])
 return c.json({disconnected:true,revoke})
})
