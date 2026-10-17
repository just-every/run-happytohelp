import {senderDomainRoutes} from './sender-domain-routes'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope,text} from '../management/common'
import {inboundRecoveryRoutes} from './inbound-recovery-routes'
import {githubCredential,githubToken} from './github'
import {listGithubRepositories} from './github-discovery'
import {sendEmail,emailConfigured} from './email'
import {emailMode,selectedEmailProvider} from './email-provider'
import {receivingState} from './inbound-capability'
import {installation} from '../management/installation'
import {mailbox} from './inbound-routing'
import {updateEmailSettings} from './mailbox-settings'
import {suspendedRoutes} from './suspended'
import {createMailboxRoutes} from './mailboxes'
import {receiveMailboxMessage} from './mailbox-ingress'
import {emailFollowupRoutes} from './email-followup-routes'
export const integrations=new Hono<AppEnv>()
integrations.route('/',inboundRecoveryRoutes)
integrations.route('/',senderDomainRoutes())
integrations.route('/',suspendedRoutes)
integrations.route('/',createMailboxRoutes(receiveMailboxMessage))
integrations.route('/',emailFollowupRoutes)
// Sending and receiving are reported as they are, so the page never asks for a key that is set
// or offers a receiving address that no mail can reach.
integrations.get('/projects/:projectId/email-settings',async c=>{const a=await scope(c,true),row=await c.env.DB.prepare('SELECT * FROM email_settings WHERE project_id=?').bind(a.projectId).first<any>(),configured=Boolean(emailConfigured(c.env))
 return c.json({data:row?{...row,email_to_address:row.inbound_address||null}:{email_to_address:null},configured,
  sending:{mode:emailMode(c.env),provider:configured?selectedEmailProvider(c.env):null,from:configured?mailbox(c.env.EMAIL_FROM):null},
  receiving:await receivingState(c.env,row?.inbound_address),installation:installation(c.env,c.req.url)})})
integrations.put('/projects/:projectId/email-settings',async c=>{
 const a=await scope(c,true),b=await c.req.json()
 const address=text(b.email_from_address||b.from_address,320)
 const rawInbound=b.inbound_address?text(b.inbound_address,320):null
 const inbound=rawInbound?mailbox(rawInbound):null
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)||rawInbound&&!inbound)throw new HTTPException(400,{message:'Use valid sender and inbound mailbox addresses'})
 await updateEmailSettings(c.env.DB,{projectId:a.projectId,fromName:text(b.email_from_name||b.from_name||'',200),fromAddress:address,inboundAddress:inbound,enabled:Boolean(b.is_enabled),updatedAt:Date.now()})
 return c.json({updated:true})
})
integrations.post('/projects/:projectId/email-settings/test',async c=>{const a=await scope(c,true),b=await c.req.json(),user=await c.env.DB.prepare('SELECT email FROM users WHERE id=?').bind(a.id).first<{email:string}>();return c.json(await sendEmail(c.env,{to:user!.email,subject:'HappyToHelp email verification',text:'Your configured HappyToHelp email provider delivered this verification message.',projectId:a.projectId,idempotencyKey:text(b.idempotencyKey,200)}))})
integrations.get('/projects/:projectId/github',async c=>{const a=await scope(c,true),row=await c.env.DB.prepare('SELECT * FROM github_settings WHERE project_id=?').bind(a.projectId).first<any>();const place=installation(c.env,c.req.url),missing=(['GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','INTEGRATION_ENCRYPTION_KEY'] as const).filter(name=>!c.env[name]);return c.json({data:row?{...row,repositories:JSON.parse(row.repositories_json)}:null,configured:Boolean(await githubToken(c.env,a.projectId)),oauth:{ready:!missing.length,missing,callbackUrl:new URL('/api/management/github/callback',place.origin).href},installation:place})})
integrations.put('/projects/:projectId/github',async c=>{const a=await scope(c,true),b=await c.req.json();if(!Array.isArray(b.repositories)||b.repositories.length>50||b.repositories.some((r:unknown)=>typeof r!=='string'||!/^[-\w.]+\/[-\w.]+$/.test(r)))throw new HTTPException(400,{message:'Repository names must be owner/name'});await c.env.DB.prepare('INSERT INTO github_settings VALUES(?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET repositories_json=excluded.repositories_json,allow_agents=excluded.allow_agents,allow_contacts=excluded.allow_contacts,updated_at=excluded.updated_at').bind(a.projectId,JSON.stringify([...new Set(b.repositories)]),b.allow_agents===false?0:1,b.allow_contacts?1:0,Date.now()).run();return c.json({updated:true})})
integrations.get('/projects/:projectId/github/repositories',async c=>{const a=await scope(c,true),credential=await githubCredential(c.env,a.projectId);if(!credential)throw new HTTPException(503,{message:'GitHub provider is not configured'});return c.json({data:await listGithubRepositories(c.env,a.projectId,credential)})})
