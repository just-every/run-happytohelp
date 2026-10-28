import {rerMail} from '../../integrations/rer-mail-contract'
import type {Env} from '../../../platform/env'
import {hashToken} from '../../../platform/auth'
import {emailAddress} from '../../integrations/inbound-routing'
import {emailMode,selectedEmailProvider} from '../../integrations/email-provider'
import {localMailOrigin} from '../../../edition/local-mail/configuration'
import {inboundNeedsCustomDomain} from './inbound-domain'
// @ts-ignore The installed runtime uses this same provider registry.
import {getProviderFromModel} from '../../ai-support/vendor/ensemble/model_providers/model_provider.js'
import type {Environment,StepId} from './types'

export const modelSecrets:Record<string,string> = {openai:'OPENAI_API_KEY',anthropic:'ANTHROPIC_API_KEY',google:'GOOGLE_API_KEY',deepseek:'DEEPSEEK_API_KEY',xai:'XAI_API_KEY',openrouter:'OPENROUTER_API_KEY'}
const rawKey=(env:Env,provider:string|null)=>{const name=provider?modelSecrets[provider]:undefined;return name?env[name]||(provider==='google'?env.GEMINI_API_KEY:undefined):undefined}
/** Whether the installation holds a usable key for a provider. Presence only; the value never leaves the server. */
export function keyInstalled(env:Env,provider:string|null) {const value=rawKey(env,provider);return typeof value==='string'&&Boolean(value.trim())}
export const modelProvider=(model:string):string|null=>model?String(getProviderFromModel(model)):null
/** A loopback trial started by the local installer, as the local edition recognises it. A deployed installation is hosted. */
export const activationEnvironment=(env:Env):Environment=>localMailOrigin(env)?'local':'hosted'

export async function activationConfiguration(env:Env, projectId:string) {
 const [project,email,owners] = await Promise.all([
  env.DB.prepare('SELECT p.name,p.widget_key,p.allowed_origin,s.settings_json FROM projects p LEFT JOIN project_settings s ON s.project_id=p.id WHERE p.id=?').bind(projectId).first<any>(),
  env.DB.prepare('SELECT * FROM email_settings WHERE project_id=?').bind(projectId).first<any>(),
  env.DB.prepare("SELECT u.id,u.email FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.project_id=? AND m.role='owner' ORDER BY u.id").bind(projectId).all<{id:string;email:string}>(),
 ])
 const settings=JSON.parse(project?.settings_json||'{}')
 const assistantId=settings.default_visitor_ai_id || settings.default_responder
 const assistant=assistantId?await env.DB.prepare('SELECT id,model,is_enabled FROM ai_profiles WHERE project_id=? AND id=?').bind(projectId,assistantId).first<any>():null
 const model=typeof assistant?.model==='string'?assistant.model:''
 const provider=modelProvider(model)
 const secretName=provider?modelSecrets[provider]:null
 const key=rawKey(env,provider)
 const sender=emailAddress(email?.from_address||(rerMail(env)?env.MAIL_FROM:env.EMAIL_FROM))
 // The owner has chosen an address other than the installation sender the workspace was seeded with.
 const senderOverridden=Boolean(email?.from_address)&&!rerMail(env)&&sender!==emailAddress(env.EMAIL_FROM)
 // The workspace's own sending address, proposed at creation while mail goes out from the installation sender.
 const proposedSender=rerMail(env)?null:emailAddress(settings.proposed_sender)
 const providerName=selectedEmailProvider(env)
 // Digests stay server-side. Never return credential material or its digest to the browser.
 const mailIdentity=[providerName,sender,email?.from_name||'',env.EMAIL_FROM,env.EMAIL_ACCOUNT_ID,env.EMAIL_API_KEY,...(rerMail(env)?[env.MAIL_API_KEY,env.RER_MAILBOX_ID]:[])]
 const values:Record<StepId,unknown>={
  owner_mail:[mailIdentity,owners.results],sender_dns:proposedSender&&!senderOverridden?[mailIdentity,proposedSender]:mailIdentity,
  inbound_address:[email?.inbound_address,email?.is_enabled,email?.updated_at,env.INBOUND_EMAIL_TOKEN,inboundNeedsCustomDomain(email?.inbound_address)],
  model_key:[assistantId,model,assistant?.is_enabled,provider,key],spend_ceilings:env.AI_DAILY_CEILINGS||null,
  published_article:null,widget_origin:project?.allowed_origin,widget_seen:[project?.allowed_origin,env.PREVIEW_ORIGIN],
 }
 const fingerprints=Object.fromEntries(await Promise.all(Object.entries(values).map(async([id,value])=>[id,await hashToken(JSON.stringify(value)??'null')])) ) as Record<StepId,string>
 return {projectId,project,settings,email,owners:owners.results,assistant,model,provider,secretName,key,sender,senderOverridden,proposedSender,providerName,
  environment:activationEnvironment(env),mailMode:emailMode(env),fingerprints}
}
export type Configuration=Awaited<ReturnType<typeof activationConfiguration>>
