import {checkInbound} from './inbound-probe'
import type {Env} from '../../../platform/env'
import {aiCeilings} from '../../../platform/limit-config'
import type {Configuration} from './configuration'
import type {Probe,StepId} from './types'

export function validWidgetOrigin(origin:unknown,preview:unknown,appOrigin?:unknown) {
 if(typeof origin!=='string'||origin===preview)return false
 try {const url=new URL(origin);if(typeof appOrigin==='string'&&url.origin===new URL(appOrigin).origin)return false;return url.origin===origin&&!url.username&&!url.password&&(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))}catch{return false}
}
export async function widgetVisit(env:Env,config:Configuration) {
 const origin=config.project?.allowed_origin
 if(!validWidgetOrigin(origin,env.PREVIEW_ORIGIN,env.APP_ORIGIN))return null
 const ping=await env.DB.prepare('SELECT origin, checked_at, receipt_ref FROM activation_widget_pings WHERE project_id=? AND origin=?')
  .bind(config.projectId,origin).first<{origin:string;checked_at:number;receipt_ref:string}>()
 if(!ping)return null
 const checkedAt=new Date(ping.checked_at).toISOString()
 return {state:'done' as const,checkedAt,detail:`Authenticated widget ping observed at ${checkedAt} on ${ping.origin}. This is an installation observation, not a claim a visitor remains online.`,receiptRef:ping.receipt_ref}
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
  return await widgetVisit(env,config)??{state:'pending',detail:'Visit the configured website with the installed widget. An authenticated contact ping is required; owner preview activity does not count.'}
 }
 if(id==='inbound_address')return checkInbound(env,config)
 return {state:'unavailable',detail:'This step requires provider validation.'}
}
