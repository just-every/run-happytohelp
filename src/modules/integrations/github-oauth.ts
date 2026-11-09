import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {requireActor,hashToken} from '../../platform/auth'
import {scope} from '../management/common'
import {encryptToken} from './secrets'
import {requireStepUp} from '../identity/two-factor/step-up'
import {oncePerRequest} from '../../platform/read-effects'
export const githubOAuth=new Hono<AppEnv>()
githubOAuth.post('/projects/:projectId/github/connect',async c=>{const a=await scope(c,true);await requireStepUp(c,a,'integration.install');if(!c.env.GITHUB_CLIENT_ID||!c.env.GITHUB_CLIENT_SECRET||!c.env.INTEGRATION_ENCRYPTION_KEY)throw new HTTPException(503,{message:'GitHub OAuth is not configured'});const state=crypto.randomUUID()+crypto.randomUUID(),redirect=new URL('/api/management/github/callback',String(c.env.APP_ORIGIN||new URL(c.req.url).origin)).href;await c.env.DB.prepare('INSERT INTO github_oauth_states VALUES(?,?,?,?,?,NULL)').bind(await hashToken(state),a.projectId,a.id,redirect,Date.now()+600000).run();const url=new URL('https://github.com/login/oauth/authorize');url.search=new URLSearchParams({client_id:String(c.env.GITHUB_CLIENT_ID),redirect_uri:redirect,scope:'repo read:org',state}).toString();return c.json({url:url.href})})
/** GitHub returns the browser here. The state's consumption, and the code's exchange with the account read after it,
 * each run once per request: a dispatch again after a refused D1 read (platform/d1-overload.ts) continues with the
 * first dispatch's state and token, so it answers what the first would have answered. */
githubOAuth.get('/github/callback',async c=>{
 const actor=await requireActor(c)
 const row=await oncePerRequest(c.req.raw,'github-callback-state',async()=>{
  const state=await hashToken(c.req.query('state')||''),row=await c.env.DB.prepare('SELECT s.* FROM github_oauth_states s JOIN memberships m ON m.project_id=s.project_id AND m.user_id=s.user_id WHERE s.state_hash=? AND s.user_id=? AND s.consumed_at IS NULL AND s.expires_at>? AND m.role IN (\'owner\',\'admin\')').bind(state,actor.id,Date.now()).first<any>();if(!row)throw new HTTPException(403)
  const claimed=await c.env.DB.prepare('UPDATE github_oauth_states SET consumed_at=? WHERE state_hash=? AND consumed_at IS NULL').bind(Date.now(),state).run();if(!claimed.meta.changes)throw new HTTPException(409)
  return row
 })
 if(c.req.query('error'))return c.redirect(`/projects/${row.project_id}/settings?github=cancelled`)
 const code=c.req.query('code');if(!code)throw new HTTPException(400)
 const {token,user}=await oncePerRequest(c.req.raw,'github-callback-exchange',async()=>{const tokenResponse=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:String(c.env.GITHUB_CLIENT_ID),client_secret:String(c.env.GITHUB_CLIENT_SECRET),code,redirect_uri:row.redirect_uri}),redirect:'manual',signal:AbortSignal.timeout(20000)});if(!tokenResponse.ok)throw new HTTPException(502,{message:'GitHub token exchange failed'});const token=await tokenResponse.json() as any;if(typeof token.access_token!=='string')throw new HTTPException(502,{message:'GitHub did not return a token'});const userResponse=await fetch('https://api.github.com/user',{headers:{Authorization:`Bearer ${token.access_token}`,Accept:'application/vnd.github+json','User-Agent':'HappyToHelp-native'},redirect:'manual'});if(!userResponse.ok)throw new HTTPException(502);const user=await userResponse.json() as any;if(!user.id||!user.login)throw new HTTPException(502);return {token,user}})
 await c.env.DB.prepare('INSERT INTO github_connections VALUES(?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET github_user_id=excluded.github_user_id,github_login=excluded.github_login,token_cipher=excluded.token_cipher,scopes=excluded.scopes,connected_at=excluded.connected_at').bind(row.project_id,String(user.id),user.login,await encryptToken(c.env,row.project_id,token.access_token),token.scope||'',Date.now()).run();
 return c.redirect(`/projects/${row.project_id}/settings?github=connected`)
})
githubOAuth.delete('/projects/:projectId/github',async c=>{const a=await scope(c,true);await c.env.DB.batch([c.env.DB.prepare('DELETE FROM github_connections WHERE project_id=?').bind(a.projectId),c.env.DB.prepare("UPDATE github_settings SET repositories_json='[]',allow_agents=0,allow_contacts=0,updated_at=? WHERE project_id=?").bind(Date.now(),a.projectId)]);return c.json({disconnected:true})})
