import type {Env} from '../../platform/env'
import type {Generation} from './repository'
export function failureCategory(value:unknown){
 const message=String(value||'')
 if(/GENERATION_DEADLINE|timeout|timed out|TimeoutError/i.test(message))return 'timeout'
 if(/CONFIGURATION_REQUIRED|PROVIDER_NOT_SELECTED/.test(message))return 'configuration'
 if(/superseded|PROCEDURE_STOPPED|authority changed|GENERATION_SUPERSEDED/i.test(message))return 'authority-changed'
 if(/Unissued|Stale|Invalid|denied|revoked|required/i.test(message))return 'denied'
 return message?'provider-or-runtime-error':null
}
/** Trace what the server actually invoked, without retaining model arguments or
 * tool output. Every invocation rechecks the conversation's current authority. */
export function tracedTools(env:Env,row:Generation,tools:any[],checkCurrent:()=>Promise<void>){
 return tools.map(tool=>({...tool,function:async(...args:any[])=>{
  const id=crypto.randomUUID(),name=tool.definition.function.name,proposal=name==='propose_followup',assignment=name==='switch_agent'
  await env.DB.prepare("INSERT INTO ai_tool_traces(id,generation_id,tool_name,state,started_at,approval,authority_scope) VALUES(?,?,?,'started',?,?,?)").bind(id,row.id,name,Date.now(),proposal?'human-review-required':assignment?'assignment-only':'not-required-read-only',row.kind==='suggestions'?'operator-project':'conversation-recipient').run()
  try{
   await checkCurrent()
   const result=await tool.function(...args),handoff=assignment&&result?.transferred===true,denied=result?.found===false||assignment&&!handoff
   await env.DB.prepare('UPDATE ai_tool_traces SET state=?,finished_at=?,error_category=?,responsible_user_id=? WHERE id=?').bind(handoff?'handoff':denied?'denied':'completed',Date.now(),denied?'unavailable-or-denied':null,handoff?result.agent.id:null,id).run()
   if(!handoff)await checkCurrent()
   return result
  }catch(error){
   await env.DB.prepare("UPDATE ai_tool_traces SET state=?,finished_at=?,error_category=? WHERE id=? AND state<>'handoff'").bind(['denied','authority-changed'].includes(failureCategory(error)||'')?'denied':'failed',Date.now(),failureCategory(error),id).run()
   throw error
  }
 }}))
}
