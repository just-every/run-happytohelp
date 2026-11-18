import {checkInbound} from './inbound-probe'
import type {Env} from '../../../platform/env'
import {aiCeilings} from '../../../platform/limit-config'
import type {Configuration} from './configuration'
import type {Probe,StepId} from './types'

export function validWidgetOrigin(origin:unknown,preview:unknown,appOrigin?:unknown) {
 if(typeof origin!=='string'||origin===preview)return false
 try {const url=new URL(origin);if(typeof appOrigin==='string'&&url.origin===new URL(appOrigin).origin)return false;return url.origin===origin&&!url.username&&!url.password&&(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))}catch{return false}
}
export async function localProbe(env:Env,config:Configuration,id:StepId):Promise<Probe> {
 if(id==='spend_ceilings') {
  try {
   const limits=aiCeilings(env)
   const source=env.AI_DAILY_CEILINGS?'Installation overrides with defaults for omitted fields':'Installation defaults'
   return {state:'done',detail:`${source}: ${limits.repliesPerProject} automatic replies/project/day, ${limits.repliesPerInstallation} automatic replies/installation/day, USD ${limits.spendUsdPerProject} recorded automatic-reply spend/project/day, ${limits.contextRunsPerProject} visitor context runs/project/day. Reset: 00:00 UTC. These runtime ceilings are not provider account billing caps.`,receiptRef:'configuration:AI_DAILY_CEILINGS'}
  } catch {return {state:'failed',detail:'AI_DAILY_CEILINGS is invalid. Set a JSON object containing positive supported limits in installation settings.'}}
 }
 if(id==='widget_origin')return validWidgetOrigin(config.project?.allowed_origin,env.PREVIEW_ORIGIN,env.APP_ORIGIN)?{state:'done',detail:`Saved exact widget origin: ${config.project.allowed_origin}. Install the widget on this website.`,receiptRef:`origin:${config.project.allowed_origin}`}:{state:'pending',detail:'Save an exact HTTPS widget website origin in Widget settings. The owner preview origin does not count.'}
 if(id==='widget_seen') {
  if(!validWidgetOrigin(config.project?.allowed_origin,env.PREVIEW_ORIGIN,env.APP_ORIGIN))return {state:'pending',detail:'Save the widget website origin before observing a ping.'}
  const ping=await env.DB.prepare('SELECT * FROM activation_widget_pings WHERE project_id=? AND origin=?').bind(config.projectId,config.project.allowed_origin).first<any>()
  return ping?{state:'done',detail:`Authenticated widget ping observed at ${new Date(ping.checked_at).toISOString()} on ${ping.origin}. This is an installation observation, not a claim a visitor remains online.`,receiptRef:ping.receipt_ref}:{state:'pending',detail:'Visit the configured website with the installed widget. An authenticated contact ping is required; owner preview activity does not count.'}
 }
 if(id==='inbound_address')return checkInbound(env,config)
 return {state:'unavailable',detail:'This step requires provider validation.'}
}
