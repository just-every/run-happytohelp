import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env} from '../../../platform/env'
import {scope,text} from '../../management/common'
import {requireStepUp} from '../../identity/two-factor/step-up'
import {auditStatement,requestSource} from '../../audit/record'
import {address,assertAddressAvailable,getMailbox,publicMailbox,saveConnection} from './store'
import {mailboxOAuthRoutes,beginOAuth,callbackUrl} from './oauth-routes'
import {oauthConfig} from './oauth-provider'
import {socketHosts,socketPorts,validateSocketHost,validateSocketPort,verifyImap} from './socket'
import {syncMailbox} from './sync'
import type {MailboxIncoming,MailboxRow,ImapCredential} from './types'

/** The host supplies actual MIME admission. Missing wiring is visibly unavailable. */
export function createMailboxRoutes(receive?:(env:Env,message:MailboxIncoming)=>Promise<void>){
 const app=new Hono<AppEnv>()
 app.route('/',mailboxOAuthRoutes)
 app.get('/projects/:projectId/mailboxes',async c=>{
  const actor=await scope(c),rows=await c.env.DB.prepare('SELECT * FROM mailbox_connections WHERE project_id=? ORDER BY created_at,id').bind(actor.projectId).all<MailboxRow>()
  const oauth=Object.fromEntries((['gmail','microsoft'] as const).map(provider=>{const config=oauthConfig(c.env,provider);return [provider,{ready:Boolean(config.clientId&&config.clientSecret&&c.env.INTEGRATION_ENCRYPTION_KEY),callbackUrl:callbackUrl(c,provider)}]}))
  return c.json({data:await Promise.all(rows.results.map(row=>publicMailbox(c.env,row))),oauth,socketHosts:socketHosts(c.env),socketPorts:socketPorts(c.env)})
 })
 app.post('/projects/:projectId/mailboxes',async c=>{
  const actor=await scope(c,true);await requireStepUp(c,actor,'integration.install')
  const body=await c.req.json();if(body.provider!=='forwarding')throw new HTTPException(400,{message:'Use the provider connect endpoint'})
  const primary=address(body.address),aliases=body.aliases||[]
  if(!Array.isArray(aliases)||aliases.length>50)throw new HTTPException(400)
  const id=crypto.randomUUID()
  await saveConnection(c.env,{id,projectId:actor.projectId,provider:'forwarding',address:primary,displayName:text(body.displayName||'',200),actorId:actor.id,addresses:[primary,...aliases.map(address)].map(value=>({address:value,canSend:false}))})
  return c.json({data:await publicMailbox(c.env,await getMailbox(c.env,actor.projectId,id))},201)
 })
 app.post('/projects/:projectId/mailboxes/imap',async c=>{
  const actor=await scope(c,true);await requireStepUp(c,actor,'integration.install')
  const body=await c.req.json(),credential=imapInput(c.env,body),primary=address(body.address),id=crypto.randomUUID()
  await assertAddressAvailable(c.env,actor.projectId,primary,id)
  try{await verifyImap(c.env,credential)}catch{throw new HTTPException(502,{message:'IMAP or SMTP connection failed; verify TLS hosts and credentials'})}
  // Re-read membership after the external credential check.
  await scope(c,true)
  await saveConnection(c.env,{id,projectId:actor.projectId,provider:'imap',address:primary,displayName:text(body.displayName||'',200),actorId:actor.id,credential,addresses:[{address:primary,canSend:true}]})
  return c.json({data:await publicMailbox(c.env,await getMailbox(c.env,actor.projectId,id))},201)
 })
 app.post('/projects/:projectId/mailboxes/:mailboxId/reconnect',async c=>{
  const actor=await scope(c,true);await requireStepUp(c,actor,'integration.install')
  const row=await getMailbox(c.env,actor.projectId,c.req.param('mailboxId'))
  if(row.provider==='gmail'||row.provider==='microsoft')return beginOAuth(c,row.provider,row.id)
  const body=await c.req.json().catch(()=>({}))
  if(body.address&&address(body.address)!==row.address)throw new HTTPException(409,{message:'Reconnect the original mailbox address'})
  const credential=row.provider==='imap'?imapInput(c.env,body):undefined
  if(credential)try{await verifyImap(c.env,credential)}catch{throw new HTTPException(502,{message:'IMAP or SMTP reconnect failed'})}
  await scope(c,true)
  // Reconnection changes credentials, never the configured receiving aliases.
  const retained=(await c.env.DB.prepare('SELECT address FROM mailbox_addresses WHERE mailbox_id=? AND project_id=? ORDER BY address LIMIT 100').bind(row.id,actor.projectId).all<{address:string}>()).results
  const addresses=[...new Set([row.address,...retained.map(alias=>alias.address)])].map(address=>({address,canSend:row.provider==='imap'}))
  await saveConnection(c.env,{id:row.id,projectId:actor.projectId,provider:row.provider,address:row.address,displayName:row.display_name,actorId:actor.id,credential,addresses,expectedVersion:row.credential_version})
  return c.json({data:await publicMailbox(c.env,await getMailbox(c.env,actor.projectId,row.id))})
 })
 app.delete('/projects/:projectId/mailboxes/:mailboxId',async c=>{
  const actor=await scope(c,true);await requireStepUp(c,actor,'integration.remove')
  const row=await getMailbox(c.env,actor.projectId,c.req.param('mailboxId'))
  await c.env.DB.batch([
   c.env.DB.prepare("UPDATE mailbox_connections SET status='disconnected',credential_cipher=NULL,credential_version=credential_version+1,sync_lock=NULL,sync_lock_until=NULL,error_code=NULL,updated_at=? WHERE id=? AND project_id=?").bind(Date.now(),row.id,actor.projectId),
   c.env.DB.prepare('DELETE FROM mailbox_addresses WHERE mailbox_id=? AND project_id=?').bind(row.id,actor.projectId),
   c.env.DB.prepare('UPDATE mailbox_oauth_states SET consumed_at=? WHERE project_id=? AND mailbox_id=? AND consumed_at IS NULL').bind(Date.now(),actor.projectId,row.id),
   auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'mailbox.disconnected',outcome:'succeeded',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'mailbox',id:row.id}}),
  ])
  return c.json({disconnected:true})
 })
 app.patch('/projects/:projectId/mailboxes/:mailboxId',async c=>{
  const actor=await scope(c,true),row=await getMailbox(c.env,actor.projectId,c.req.param('mailboxId')),body=await c.req.json()
  const from=body.senderAddress===undefined?row.sender_address:address(body.senderAddress)
  if(from){const alias=await c.env.DB.prepare('SELECT can_send FROM mailbox_addresses WHERE address=? AND mailbox_id=?').bind(from,row.id).first<{can_send:number}>();if(!alias||(row.provider!=='forwarding'&&!alias.can_send))throw new HTTPException(403,{message:'Sender alias is not authorized'})}
  await c.env.DB.batch([c.env.DB.prepare('UPDATE mailbox_connections SET display_name=?,sender_address=?,updated_at=? WHERE id=? AND project_id=?').bind(body.displayName===undefined?row.display_name:text(body.displayName,200),from,Date.now(),row.id,actor.projectId),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'mailbox.sender_updated',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'mailbox',id:row.id}})])
  return c.json({data:await publicMailbox(c.env,await getMailbox(c.env,actor.projectId,row.id))})
 })
 app.post('/projects/:projectId/mailboxes/:mailboxId/aliases',async c=>{
  const actor=await scope(c,true);await requireStepUp(c,actor,'integration.install')
  const row=await getMailbox(c.env,actor.projectId,c.req.param('mailboxId')),body=await c.req.json(),value=address(body.address)
  if(row.status==='disconnected')throw new HTTPException(409)
  const count=await c.env.DB.prepare('SELECT count(*) AS n FROM mailbox_addresses WHERE mailbox_id=?').bind(row.id).first<{n:number}>();if(count!.n>=100)throw new HTTPException(400)
  await assertAddressAvailable(c.env,actor.projectId,value,row.id)
  try{await c.env.DB.batch([c.env.DB.prepare('INSERT INTO mailbox_addresses VALUES(?,?,?,?,0)').bind(value,row.id,actor.projectId,row.provider==='imap'?1:0),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'mailbox.alias_added',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'mailbox',id:row.id}})])}catch{throw new HTTPException(409,{message:'Alias already configured'})}
  return c.json({updated:true})
 })
 app.delete('/projects/:projectId/mailboxes/:mailboxId/aliases/:alias',async c=>{
  const actor=await scope(c,true);await requireStepUp(c,actor,'integration.remove')
  const row=await getMailbox(c.env,actor.projectId,c.req.param('mailboxId')),value=address(c.req.param('alias'))
  if(value===row.address||value===row.sender_address)throw new HTTPException(409,{message:'Select another sender before removing this alias; primary mailbox cannot be removed'})
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM mailbox_addresses WHERE mailbox_id=? AND project_id=? AND address=? AND is_primary=0').bind(row.id,actor.projectId,value),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'mailbox.alias_removed',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'mailbox',id:row.id}})])
  return c.json({deleted:true})
 })
 app.put('/projects/:projectId/mailboxes/:mailboxId/signatures/:agentId',async c=>{
  const actor=await scope(c,true),row=await getMailbox(c.env,actor.projectId,c.req.param('mailboxId')),agent=c.req.param('agentId'),body=await c.req.json()
  if(agent!=='default'&&!await c.env.DB.prepare('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?').bind(actor.projectId,agent).first())throw new HTTPException(404,{message:'Workspace agent not found'})
  const html=body.html?text(body.html,20000):null
  // Signature HTML is not a web document. Refuse active content and remote embeds.
  if(html&&/<\s*(?:script|iframe|object|embed|style|link|meta)|\bon\w+\s*=|(?:javascript|data)\s*:/i.test(html))throw new HTTPException(400,{message:'Signature contains active HTML'})
  const plain=text(body.text||'',10000)
  const statement=!plain&&!html?c.env.DB.prepare('DELETE FROM mailbox_signatures WHERE mailbox_id=? AND agent_id=?').bind(row.id,agent):c.env.DB.prepare('INSERT INTO mailbox_signatures VALUES(?,?,?,?,?) ON CONFLICT(mailbox_id,agent_id) DO UPDATE SET text=excluded.text,html=excluded.html,updated_at=excluded.updated_at').bind(row.id,agent,plain,html,Date.now())
  await c.env.DB.batch([statement,auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'mailbox.signature_updated',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'mailbox',id:row.id}})])
  return c.json({updated:true})
 })
 for(const action of ['poll','backfill'] as const)app.post(`/projects/:projectId/mailboxes/:mailboxId/${action}`,async c=>{
  const actor=await scope(c,true)
  if(!receive)throw new HTTPException(503,{message:'Mailbox ingestion is not installed'})
  return c.json(await syncMailbox(c.env,actor.projectId,c.req.param('mailboxId')!,message=>receive(c.env,message),{backfill:action==='backfill',actorId:actor.id}))
 })
 return app
}
function imapInput(env:AppEnv['Bindings'],body:any):ImapCredential{
 const secret=(value:unknown)=>{if(typeof value!=='string'||!value||value.length>2048||/[\r\n\0]/.test(value))throw new HTTPException(400,{message:'Invalid mailbox credential'});return value}
 return {imapHost:validateSocketHost(env,body.imapHost),smtpHost:validateSocketHost(env,body.smtpHost),imapPort:validateSocketPort(env,body.imapPort,993),smtpPort:validateSocketPort(env,body.smtpPort,465),username:secret(body.username),password:secret(body.password),...(body.smtpUsername?{smtpUsername:secret(body.smtpUsername)}:{}),...(body.smtpPassword?{smtpPassword:secret(body.smtpPassword)}:{})}
}
export const mailboxRoutes=createMailboxRoutes()
