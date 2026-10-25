import type {Env} from '../../platform/env'
import {consumeCounter,refundCounter,type CounterPosition} from '../../platform/usage-counters'
import {ApiError} from './errors'
export async function reserveCreates(env:Env,project:string,credential:any){
 const taken:CounterPosition[]=[]
 try{
  for(const [kind,seconds,subject,limit] of [['credential',60,credential.family_id,credential.create_minute],['credential',86400,credential.family_id,credential.create_day],['workspace',60,project,120],['workspace',86400,project,20000]] as const){
   const result=await consumeCounter(env,{name:'api-create:'+kind+':'+seconds,seconds},subject,limit)
   if(!result.allowed)throw new ApiError(429,kind,'Create quota exceeded',{}, {'Retry-After':String(Math.max(1,Math.ceil((result.expiresAt-Date.now())/1000))),'RateLimit-Limit':String(limit),'RateLimit-Remaining':'0','RateLimit-Reset':String(Math.ceil(result.expiresAt/1000))})
   taken.push(result)
  }
 }catch(error){for(const position of taken)await refundCounter(env,position);throw error}
 return async()=>{for(const position of taken)await refundCounter(env,position)}
}

// Keep one over-cap request for review; further attempts cannot fill Suspended.
// Charge every supplied identity, across credentials, so adding an identifier
// cannot reset a requester's budget. Failed atomic admissions refund capacity.
export async function reserveRequester(env:Env,project:string,digests:string[]){
 const row=await env.DB.prepare("SELECT json_extract(settings_json,'$.api_requester_hourly_cap') cap FROM project_settings WHERE project_id=?").bind(project).first<{cap:number}>()
 const cap=row?.cap??5,taken:CounterPosition[]=[]
 let held=false
 try{
  for(const digest of [...new Set(digests)].sort()){
   const result=await consumeCounter(env,{name:'api-requester',seconds:3600},project+':'+digest,cap+1)
   if(!result.allowed)throw new ApiError(429,'requester','Requester hourly cap exceeded',{}, {'Retry-After':String(Math.max(1,Math.ceil((result.expiresAt-Date.now())/1000))),'RateLimit-Limit':String(cap),'RateLimit-Remaining':'0','RateLimit-Reset':String(Math.ceil(result.expiresAt/1000))})
   taken.push(result);held ||= (result.used??0)>cap
  }
 }catch(error){for(const position of taken)await refundCounter(env,position);throw error}
 return {held,refund:async()=>{for(const position of taken)await refundCounter(env,position)}}
}
