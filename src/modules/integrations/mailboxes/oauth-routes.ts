import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Context} from 'hono'
import type {AppEnv} from '../../../platform/env'
import {hashToken,requireActor} from '../../../platform/auth'
import {scope,text} from '../../management/common'
import {requireStepUp} from '../../identity/two-factor/step-up'
import {encryptToken,decryptToken} from '../secrets'
import {base64url} from './http'
import {assertOAuthConfig,exchangeToken,providerIdentity,type OAuthProvider} from './oauth-provider'
import {getMailbox,saveConnection} from './store'
import {auditStatement,requestSource} from '../../audit/record'

export const oauthProvider=(value:unknown):OAuthProvider=>{if(value!=='gmail'&&value!=='microsoft')throw new HTTPException(400,{message:'Choose Gmail or Microsoft'});return value}
export function callbackUrl(c:Context<AppEnv>,provider:OAuthProvider){
 const configured=String(c.env.APP_ORIGIN||new URL(c.req.url).origin),origin=new URL(configured)
 if(origin.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(origin.hostname))throw new HTTPException(503,{message:'A secure application origin is required'})
 return new URL(`/api/management/mailboxes/oauth/${provider}/callback`,origin.origin).href
}
export async function beginOAuth(c:Context<AppEnv>,provider:OAuthProvider,mailboxId?:string){
 const actor=await scope(c,true);await requireStepUp(c,actor,'integration.install')
 const config=assertOAuthConfig(c.env,provider),body=await c.req.json().catch(()=>({})),state=base64url(crypto.getRandomValues(new Uint8Array(32))),verifier=base64url(crypto.getRandomValues(new Uint8Array(48)))
 const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)))),redirect=callbackUrl(c,provider)
 const existing=mailboxId?await getMailbox(c.env,actor.projectId,mailboxId):null
 if(existing&&existing.provider!==provider)throw new HTTPException(400)
 const epoch=await c.env.DB.prepare('SELECT revision FROM integration_authority_epoch WHERE id=1').first<{revision:number}>()
 const hash=await hashToken(state)
 await c.env.DB.batch([
  c.env.DB.prepare('DELETE FROM mailbox_oauth_states WHERE expires_at<?').bind(Date.now()),
  c.env.DB.prepare('INSERT INTO mailbox_oauth_states VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)').bind(hash,actor.projectId,actor.id,provider,mailboxId||null,existing?.credential_version??null,existing?.display_name||text(body.displayName||'',200),await encryptToken(c.env,`${actor.projectId}:oauth:${hash}`,verifier),redirect,epoch!.revision,Date.now()+600000),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'mailbox.authorization_started',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'mailbox',id:mailboxId||provider}}),
 ])
 const url=new URL(config.authorize)
 url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:redirect,response_type:'code',scope:config.scope,state,code_challenge:challenge,code_challenge_method:'S256',...(provider==='gmail'?{access_type:'offline',prompt:'consent'}:{response_mode:'query',prompt:'select_account'})}).toString()
 return c.json({url:url.href})
}
export const mailboxOAuthRoutes=new Hono<AppEnv>()
mailboxOAuthRoutes.post('/projects/:projectId/mailboxes/connect',async c=>{
 const body=await c.req.json();return beginOAuth(c,oauthProvider(body.provider))
})
mailboxOAuthRoutes.get('/mailboxes/oauth/:provider/callback',async c=>{
 const actor=await requireActor(c),provider=oauthProvider(c.req.param('provider')),state=await hashToken(c.req.query('state')||'')
 const row=await c.env.DB.prepare(`SELECT s.* FROM mailbox_oauth_states s JOIN memberships m ON m.project_id=s.project_id AND m.user_id=s.user_id
 WHERE s.state_hash=? AND s.provider=? AND s.user_id=? AND s.expires_at>? AND s.consumed_at IS NULL AND m.role IN ('owner','admin')
 AND s.authority_revision=(SELECT revision FROM integration_authority_epoch WHERE id=1)
 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=s.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`)
 .bind(state,provider,actor.id,Date.now()).first<any>()
 if(!row)throw new HTTPException(403,{message:'Mailbox authorization expired or authority changed'})
 await requireStepUp(c,{...actor,projectId:row.project_id},'integration.install')
 const claim=await c.env.DB.prepare('UPDATE mailbox_oauth_states SET consumed_at=? WHERE state_hash=? AND consumed_at IS NULL').bind(Date.now(),state).run()
 if(!claim.meta.changes)throw new HTTPException(409)
 if(c.req.query('error'))return c.redirect(`/projects/${encodeURIComponent(row.project_id)}/settings?mailbox=cancelled`)
 const code=c.req.query('code');if(!code||code.length>8192)throw new HTTPException(400)
 const verifier=await decryptToken(c.env,`${row.project_id}:oauth:${state}`,row.verifier_cipher)
 const credential=await exchangeToken(c.env,provider,{grant_type:'authorization_code',code,redirect_uri:row.redirect_uri,code_verifier:verifier}),identity=await providerIdentity(provider,credential.accessToken)
 const existing=row.mailbox_id?await getMailbox(c.env,row.project_id,row.mailbox_id):null
 if(existing&&(existing.provider!==provider||existing.address!==identity.address))throw new HTTPException(409,{message:'Reconnect using the original mailbox account'})
 // The exchange can take seconds. Fence membership revocation during that work.
 const live=await c.env.DB.prepare(`SELECT 1 FROM memberships WHERE project_id=? AND user_id=? AND role IN ('owner','admin') AND ?=(SELECT revision FROM integration_authority_epoch WHERE id=1)`).bind(row.project_id,actor.id,row.authority_revision).first()
 if(!live)throw new HTTPException(403)
 await saveConnection(c.env,{id:row.mailbox_id||crypto.randomUUID(),projectId:row.project_id,provider,address:identity.address,displayName:row.display_name,actorId:actor.id,credential,addresses:identity.addresses,expectedVersion:row.mailbox_version??undefined,authorityRevision:row.authority_revision})
 return c.redirect(`/projects/${encodeURIComponent(row.project_id)}/settings?mailbox=connected`)
})
