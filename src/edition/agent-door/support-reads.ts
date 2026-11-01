import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {ToolRefusal,type ToolContext} from '../../vendor/agent-base/modules/agent-door/index.ts'
import {listMacros,readMacro,macroData} from '../../modules/macros/store'
import {readDraft} from '../../modules/macros/apply'
import {readProjectSettings} from '../../modules/management/read-settings'
import {actorFor,conversationRead,redacted} from './read'

export async function nativeRead<T>(run:()=>Promise<T>):Promise<T>{
 try{return await run()}catch(error){if(error instanceof HTTPException)throw new ToolRefusal(error.status===400?'invalid_arguments':'not_found');throw error}
}
export async function staffProject(env:Env,ctx:ToolContext,projectId?:string){
 if(ctx.clientId?.startsWith('edition:'))throw new ToolRefusal('insufficient_scope')
 const actor=await actorFor(env,ctx)
 if(projectId!==undefined&&projectId!==actor.projectId)throw new ToolRefusal('not_found')
 return actor
}
export async function savedReplies(env:Env,ctx:ToolContext,args:{q?:string;page?:number;limit?:number}){
 const actor=await staffProject(env,ctx)
 return redacted(await nativeRead(()=>listMacros(env,actor,args.q??'',args.page??1,args.limit??50)))
}
export async function savedReply(env:Env,ctx:ToolContext,id:string){
 const actor=await staffProject(env,ctx),{row}=await nativeRead(()=>readMacro(env,actor,id))
 return redacted({reply:{...macroData(row),id:row.macro_id}})
}
export async function ownDraft(env:Env,ctx:ToolContext,id:string){
 const actor=await staffProject(env,ctx)
 await actorFor(env,ctx,'conversations.reply');await conversationRead(env,ctx,id)
 return redacted({draft:await nativeRead(()=>readDraft(env,actor,id))})
}
/** Explicit projection, including nested schedule fields. Arbitrary settings JSON,
 * provider/connection fields and unknown future configuration never cross MCP. */
export async function projectSettings(env:Env,ctx:ToolContext,projectId:string){
 const actor=await staffProject(env,ctx,projectId),source=await readProjectSettings(env,actor.projectId),settings:Record<string,unknown>={}
 for(const key of ['id','name','allowed_origin','language','timezone','website','help_center_domain','widget_position','default_responder','unavailable_message','presence_away_message'])if(typeof source?.[key]==='string')settings[key]=source[key]
 for(const key of ['is_enabled','collect_email','is_human_response_enabled','is_available','is_availability_schedule_enabled','is_presence_away_enabled'])if(typeof source?.[key]==='boolean')settings[key]=source[key]
 if(typeof source?.presence_idle_minutes==='number')settings.presence_idle_minutes=source.presence_idle_minutes
 const schedule=source?.availability_schedule
 if(schedule&&typeof schedule==='object'){
  const safe:Record<string,unknown>={}
  for(const key of ['time_from','time_to','message'])if(typeof schedule[key]==='string')safe[key]=schedule[key]
  if(Array.isArray(schedule.days))safe.days=schedule.days.filter((day:unknown)=>typeof day==='number')
  settings.availability_schedule=safe
 }
 return redacted({settings})
}
