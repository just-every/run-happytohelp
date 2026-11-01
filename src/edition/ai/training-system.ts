// Retained system evaluation request builders; the caller supplies an explicit case context.
// @ts-ignore Retained CJS source.
import * as monitoring from '../../modules/customer-context/monitoring/prompt.js'
// @ts-ignore Retained CJS source.
import * as profiles from '../../modules/customer-context/profiles/prompt.js'
// @ts-ignore Retained CJS source.
import * as validation from '../../modules/customer-context/profiles/validation.js'
// @ts-ignore Retained schemas.
import * as schemas from '../../modules/customer-context/profiles/schemas.js'
// @ts-ignore Retained neutral orchestration.
import {runStream,TASKS} from '../../modules/ai-support/llm/orchestrator.js'
import type {Env} from '../../platform/env'
import {modelReadTools,validOptimizationResult} from '../../modules/knowledge/model-tools'
export async function executeSystemCase(env:Env,input:any,trace:any){
 const definition=input.caseDefinition,context=definition.context
 if(!context)throw new Error('System evaluation requires explicit case context')
 const options={model:input.model,maxToolCalls:4,maxToolCallRoundsPerTurn:4,modelSettings:{max_tokens:input.maxTokens}}
 const run=async(task:string,request:any,name:string,model=input.model)=>runStream({project_id:input.projectId,task,messages:[{role:'developer',content:'Knowledge references are title/link pointers. Retrieve exact knowledge through search_knowledge and read_knowledge_source before relying on its body. Preserve supplied packet evidence IDs.'},...request.messages],schema:request.schema,response_name:name,tools:await modelReadTools(env,input.projectId,'training',input.attemptId,request.packet),options:{...options,model},trace})
 if(definition.family==='monitoring'){
  const analysisRequest=monitoring.buildAnalysisRequest(context),analysis=await run(TASKS.ANALYSIS,analysisRequest,'activity_decision')
  const stages:any={analysis}
  if(analysis.decision==='insight')stages.insight=await run(TASKS.INSIGHT,monitoring.buildInsightRequest({...context,monitoring_packet:analysisRequest.packet,insight_analysis:analysis}),'activity_insight',definition.insightModel||input.model)
  return {output:stages,stages,valid:true,response:stages}
 }
 if(definition.family==='profile'){
  const names:Record<string,string>={project:'projectSchema',contact:'contactSchema',agent:'agentSchema',optimize:'projectContentOptimizeSchema',optimizeContact:'optimizeContentSchema'}
  const builder=(schemas as any)[names[definition.type]]
  if(!builder)throw new Error('Unsupported profile evaluation type')
  const request=profiles.buildProfilePrompt(definition.type,context),schema=builder(context)
  const response=await run(definition.type.startsWith('optimize')?TASKS.OPTIMIZE:TASKS.PROFILE,{...request,schema},definition.type)
  const valid=schema.safeParse(response).success&&(['optimize','optimizeContact'].includes(definition.type)?await validOptimizationResult(env,input.projectId,'training',input.attemptId,definition.type,response,request.packet):validation.isProfileCandidate(definition.type,response,request.packet))
  return {output:response,response,valid}
 }
 throw new Error('Unsupported system evaluation family')
}
