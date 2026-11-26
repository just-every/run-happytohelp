import type {Env} from '../../../platform/env'
import type {Configuration} from './configuration'
import type {Probe} from './types'
import {contextToolDefinitions} from '../../ai-support/tools'
import {handoffToolDefinition} from '../../ai-support/handoff'
import {repositoryTools} from '../../ai-support/repository-tools'
// @ts-ignore Retained Ensemble worker runtime.
import {withWorkerRuntime} from '../../ai-support/vendor/ensemble/worker-runtime.js'
// @ts-ignore Retained model execution and suggestion tool.
import {runStream,TASKS} from '../../ai-support/llm/orchestrator.js'
// @ts-ignore Retained suggestion tool.
import {replyIconTool} from '../../ai-support/assist/icons.js'

export const modelProbeProviders:ReadonlySet<string>=new Set(['openai','anthropic','google','openrouter'])

/** Confirms the selected model accepts the same tool definitions as a reply. The
 * probe passes no visitor data and gives the model no executable tools. */
export async function checkModel(env:Env,config:Configuration,token:string):Promise<Probe> {
 const {assistant,model,provider,secretName,key,projectId}=config
 if(!assistant?.is_enabled)return {state:'pending',detail:'Choose an enabled default visitor assistant in AI settings.'}
 if(!secretName||!provider)return {state:'unavailable',detail:'The selected model provider is not supported by this installation.'}
 if(typeof key!=='string'||!key.trim())return {state:'unavailable',detail:`CONFIGURATION_REQUIRED: ${secretName}. Add this secret to the installation, then check again.`}
 if(!modelProbeProviders.has(provider))return {state:'unavailable',detail:`${provider} is selected and ${secretName} is installed. Setup cannot check this provider automatically.`}
 const repositories=await repositoryTools(env,projectId,'contact',new Set())
 const tools=[
  ...Object.values(contextToolDefinitions),
  handoffToolDefinition,
  replyIconTool().definition,
  ...repositories.map(tool=>tool.definition),
 ].map(definition=>({definition}))
 let code:string|undefined
 try {
  const result=await withWorkerRuntime({apiKey:env.OPENAI_API_KEY,files:env.FILES,scope:`projects/${projectId}/setup/${token}`,settings:env},()=>runStream({
   project_id:projectId,task:TASKS.USER_REPLY,
   messages:[{role:'user',content:'This is a connection check. Reply with OK without using any tools.'}],
   tools,options:{model,abortSignal:AbortSignal.timeout(30_000),maxToolCalls:0,
    modelSettings:{tool_choice:'none',max_tokens:512,...(provider!=='openai'||/^gpt-5\.[12456]/.test(model)?{thinking_budget:0}:{})}},
   trace:{onEvent(event:{type:string;code?:string}){if(event.type==='error'&&event.code)code=event.code}},
  }))
  if(!result?.response?.trim())return {state:'unknown',detail:'The model returned no answer to the Setup check.'}
  return {state:'done',detail:`The provider returned a test reply from ${model} with the reply tool schemas.`,receiptRef:`provider:${provider}:model:${model}`}
 } catch(error) {
  const message=String(error)
  if(['invalid_api_key','authentication_error'].includes(code||'')||/\b401\b/.test(message))
   return {state:'failed',detail:'Your provider did not accept the key.'}
  if(code==='invalid_function_parameters'||/invalid schema for function/i.test(message))
   return {state:'failed',detail:'The provider rejected the assistant’s tool schema.'}
  return {state:'unknown',detail:'The provider could not complete a test reply. Check the selected model and provider account.'}
 }
}
