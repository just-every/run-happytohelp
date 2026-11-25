import {rerConfigured,rerMail} from './rer-mail-contract'
import type {Env} from '../../platform/env'
import {demoMode} from '../../demo/mode'
import {localMailOrigin} from '../../edition/local-mail/configuration'
// @ts-expect-error Shared native configuration is JavaScript without declarations.
import {mailgunConfiguration} from './mailgun-configuration.mjs'

export type EmailProvider = 'resend'|'cloudflare'|'sendgrid'|'mailgun'|'rer'
const providers:readonly EmailProvider[]=['resend','cloudflare','sendgrid','mailgun']

/** An explicit installation choice wins over credentials saved for later. */
export function emailExplicitlyOff(env:Env){return env.MAIL_MODE==='off'||!env.MAIL_MODE&&['none','disabled','off'].includes(String(env.MAIL_PROVIDER||'').trim().toLowerCase())}
/** The selected provider is explicit when supplied; the legacy default remains Resend. */
export function selectedEmailProvider(env:Env):EmailProvider|null{
 if(emailExplicitlyOff(env))return null
 if(rerMail(env))return 'rer'
 const choice=env.MAIL_MODE==='own'?'own':String(env.MAIL_PROVIDER||'').trim().toLowerCase()
 const value=(choice&&choice!=='direct'&&choice!=='own'?choice:String(env.EMAIL_PROVIDER||'resend')) as EmailProvider
 return providers.includes(value)?value:null
}
export function emailConfigured(env:Env){
 if(emailExplicitlyOff(env))return false
 if(rerMail(env))return rerConfigured(env)
 if(typeof env.H2H_CONNECTED_MESSAGE_MAILBOX==='string')return true
 if(localMailOrigin(env)||demoMode(env))return typeof env.EMAIL_FROM==='string'&&Boolean(env.EMAIL_FROM.trim())
 const provider=selectedEmailProvider(env)
 if(provider==='mailgun'){
  try{mailgunConfiguration(env);return typeof env.EMAIL_FROM==='string'&&Boolean(env.EMAIL_FROM.trim())}catch{return false}
 }
 return Boolean(provider&&typeof env.EMAIL_API_KEY==='string'&&env.EMAIL_API_KEY.trim()&&typeof env.EMAIL_FROM==='string'&&env.EMAIL_FROM.trim()&&(provider!=='cloudflare'||/^[a-f0-9]{32}$/i.test(String(env.EMAIL_ACCOUNT_ID||''))))
}
