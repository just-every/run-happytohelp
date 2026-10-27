import type {Env} from '../../platform/env'
import {toolName} from './trace'
/** Record execution at the tool boundary without arguments, results, identities or error messages. */
export function tracedTools(env:Env,attemptId:string,tools:any[]){
 const record=async(name:string,outcome:string,durationMs:number|null)=>env.DB.prepare("INSERT INTO ai_attempt_events(attempt_id,type,event_json,created_at) VALUES(?,'tool_trace',?,?)").bind(attemptId,JSON.stringify({name:toolName(name),outcome,durationMs}),new Date().toISOString()).run()
 return tools.map(tool=>({...tool,function:async(...args:any[])=>{
  const name=tool.definition?.function?.name,start=Date.now()
  await record(name,'started',null)
  try{
   const result=await tool.function(...args)
   const outcome=result?.transferred===true?'handoff':result?.found===false||result?.transferred===false?'denied':'completed'
   await record(name,outcome,Date.now()-start)
   return result
  }catch(error){await record(name,/TimeoutError|GENERATION_DEADLINE/.test(String(error))?'timeout':(error&&typeof error==='object'&&'status' in error&&[401,403].includes(Number(error.status)))||/Invalid public citations|Unissued public citation|Stale or unsafe public citation/.test(String(error))?'denied':'unknown',Date.now()-start);throw error}
 }}))
}
