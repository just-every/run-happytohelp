import assert from 'node:assert/strict'
import {assistantApp,model} from './app.mjs'
export async function proceduresJourney(){
 const a=await assistantApp({bindings:{TRAINING_PRICE_CEILINGS:JSON.stringify({[model]:{inputPerMillion:5,outputPerMillion:20}})}}),{app,ai,p,owner}=a
 const base=`/api/ai-support/projects/${p}/procedures`,key='refund-advice',call=(path='',options={})=>app.call(base+path,{token:owner,...options})
 const definition={intent:'refund',instructions:'Refund advice only. Explain the policy and escalate all payment changes to a human.',model,config:{tools:['search_knowledge','read_knowledge_source','cite_knowledge'],humanEscalation:'Payment changes require a person.',maxCost:100,maxTokens:1000}}
 try{
 assert.equal((await call(`/${key}/versions`,{token:a.workspace.tokens.operator,body:definition})).status,403)
 const v1=(await call(`/${key}/versions`,{body:definition,status:201})).data
 assert.equal(v1.version,1)
 assert.equal((await call(`/${key}/versions`,{body:{...definition,config:{...definition.config,tools:['refund']}}})).status,400,'procedures cannot invent business-action tools')
 const evaluate=async(version,expected)=>{
 ai.respond=body=>{assert.match(JSON.stringify(body.input),/Refund advice only/);return 'A human can review your request.'}
 const run=(await app.call(`/api/training/projects/${p}/runs`,{token:owner,body:{request_id:crypto.randomUUID(),kind:'simulation',procedureVersionId:version,models:[model],variants:['prototype'],max_cost:100,max_tokens:500,cases:[{id:'refund-advice',family:'customer_reply',messages:[{role:'contact',content:'Please refund me.'}],expected:{must_include_all:[expected]}}]},status:201})).data.data
 await a.run()
 return (await app.call(`/api/training/projects/${p}/runs/${run.id}`,{token:owner,status:200})).data.data
 }
 ai.respond=body=>{assert.match(JSON.stringify(body.input),/Refund advice only/,'the runner uses the immutable procedure, not client replacement policies');return 'A human can review your request.'}
 const failed=await evaluate(v1.id,'Refund complete')
 assert.equal(failed.status,'completed',JSON.stringify(failed));assert.equal(failed.cases[0].checks.passed,false)
 assert.equal((await call(`/${key}/releases`,{body:{versionId:v1.id,evaluationId:failed.id,cohortLimit:1}})).status,409)
 const v2=(await call(`/${key}/versions`,{body:{...definition,instructions:definition.instructions+' Never claim an action was completed.'},status:201})).data
 assert.equal(v2.version,2)
 const passed=await evaluate(v2.id,'human can review')
 assert.equal(passed.cases[0].checks.passed,true)
 assert.equal((await call(`/${key}/releases`,{body:{versionId:v1.id,evaluationId:passed.id,cohortLimit:1}})).status,409,'passing evidence from another version is refused')
 const release=(await call(`/${key}/releases`,{body:{versionId:v2.id,evaluationId:passed.id,cohortLimit:1},status:201})).data
 const customer=await a.visitor(),outside=await a.visitor()
 await call(`/${key}/releases/${release.id}/cohort`,{body:{conversationId:customer.conversationId},status:200})
 assert.equal((await call(`/${key}/releases/${release.id}/cohort`,{body:{conversationId:outside.conversationId}})).status,409)
 let names
 ai.respond=body=>{names=(body.tools||[]).map(t=>t.name);assert.match(JSON.stringify(body.input),/Never claim an action/);return 'A human can review your request.'}
 await customer.say('Explain refunds');await a.run()
 assert.ok(names.includes('search_knowledge'));assert.ok(!names.includes('propose_followup'))
 let trace=(await app.call(`/api/ai-support/projects/${p}/conversations/${customer.conversationId}/trace`,{token:owner,status:200})).data.traces[0]
 assert.equal(trace.procedure.versionId,v2.id);assert.equal(trace.procedure.releaseId,release.id)
 await call(`/${key}/releases/${release.id}/revoke-tool`,{body:{tool:'search_knowledge'},status:200})
 await customer.say('What about my refund?');await a.run();assert.ok(!names.includes('search_knowledge'),'revocation narrows the next production turn')
 // Native resolution, customer rating and reopen become attributable source cases.
 await app.call(`/api/dashboard/projects/${p}/conversations/${customer.conversationId}`,{token:owner,method:'PUT',body:{resolved:true},status:200})
 const cycle=await app.first('SELECT id FROM conversation_resolutions WHERE conversation_id=? ORDER BY ordinal DESC LIMIT 1',customer.conversationId)
 await app.call(`/api/conversations/${customer.conversationId}/widget-events`,{token:customer.token,body:{action:'rateResolution',data:{resolutionId:cycle.id,value:-1,comment:'Still broken'}},status:200})
 await app.call(`/api/dashboard/projects/${p}/conversations/${customer.conversationId}`,{token:owner,method:'PUT',body:{resolved:false},status:200})
 assert.equal((await call('',{status:200})).data.releases.find(r=>r.id===release.id).state,'stopped','native reopening automatically stops its exact released procedure')
 assert.equal((await call('',{status:200})).data.releases.find(r=>r.id===release.id).regression_resolution_id,cycle.id)
 assert.equal((await app.first('SELECT assigned_to FROM conversations WHERE id=?',customer.conversationId)).assigned_to,a.workspace.users.owner,'regression restores a responsible human before more AI work')
 const reportPath=`/api/ai-support/projects/${p}/procedure-reports/${key}`
 let report=(await app.call(reportPath,{token:owner,status:200})).data
 assert.equal(report.versions[0].denominator,1);assert.equal(report.versions[0].reopened,1);assert.equal(report.versions[0].negativeCsat,1)
 assert.equal(report.cases[0].resolutionId,cycle.id);assert.equal(report.cases[0].versionId,v2.id)
 assert.ok(report.accounting.length>0);assert.equal(report.providerCostEstimateUsd,report.accounting.reduce((n,r)=>n+r.cost,0));assert.ok(report.evaluationCoverage.some(v=>v.versionId===v1.id&&v.passed===0))
 assert.equal((await app.call(reportPath,{token:customer.token})).status,403)
 const proposal={fromVersionId:v2.id,resolutionIds:[cycle.id],expectedEffect:'Reduce reopened refund-advice cases with clearer human escalation.'}
 const v3=(await call(`/${key}/versions`,{body:{...definition,proposal},status:201})).data
 const callsBeforePreview=a.providerCalls()
 const replayPreview=(await call(`/${key}/versions/${v3.id}/replay-preview`,{status:200})).data
 assert.equal(replayPreview.cases[0].resolutionId,cycle.id);assert.equal(replayPreview.cases[0].sourceVersionId,v2.id)
 assert.ok(replayPreview.cases[0].messages.length>0);assert.equal(replayPreview.executionAvailable,false);assert.equal(a.providerCalls(),callsBeforePreview,'previewing historical cases never sends customer text to a provider')
 assert.equal((await call(`/${key}/versions/${v3.id}/replay-preview`,{token:customer.token})).status,403)
 const replay=await evaluate(v3.id,'human can review')
 await call(`/${key}/versions/${v3.id}/review`,{body:{state:'rejected',reason:'The first draft does not address this failure.'},status:200})
 assert.equal((await call(`/${key}/releases`,{body:{versionId:v3.id,evaluationId:replay.id,cohortLimit:1}})).status,409)
 await call(`/${key}/versions/${v3.id}/review`,{body:{state:'approved',reason:'Reviewed the case and passing replay.'},status:200})
 assert.deepEqual((await call(`/${key}/versions/${v3.id}/reviews`,{status:200})).data.reviews.map(r=>r.state),['rejected','approved'])
 const regression=(await call(`/${key}/releases/${release.id}/check-regression`,{body:{},status:200})).data
 assert.equal(regression.regression,true);assert.equal(regression.stopped,true);assert.equal(regression.reopened,1)
 const next=(await call(`/${key}/releases`,{body:{versionId:v3.id,evaluationId:replay.id,cohortLimit:1},status:201})).data
 await call(`/${key}/releases/${next.id}/cohort`,{body:{conversationId:customer.conversationId},status:200})
 assert.equal((await a.action(customer.conversationId,'assignAi',{ai_id:'ai'})).status,200,'only an explicit human handback resumes AI on the approved release')
 ai.respond=()=> 'A human can review your request.'
 await customer.say('Please explain the revised refund advice.');await a.run()
 await app.call(`/api/dashboard/projects/${p}/conversations/${customer.conversationId}`,{token:owner,method:'PUT',body:{resolved:true},status:200})
 report=(await app.call(reportPath,{token:owner,status:200})).data
 assert.equal(report.totalCases,2);assert.equal(report.versions.find(v=>v.versionId===v3.id).reopened,0)
 assert.equal(report.versions.find(v=>v.versionId===v2.id).reopenRate,1)
 await call(`/${key}/releases/${next.id}/stop`,{body:{},status:200})
 await app.call(`/api/dashboard/projects/${p}/conversations/${customer.conversationId}`,{token:owner,method:'PUT',body:{resolved:false},status:200})
 const before=a.providerCalls();await customer.say('Anyone there?');await a.run();assert.equal(a.providerCalls(),before,'stopped cohort fails closed before another provider request')
 const catalog=(await call('',{status:200})).data
 assert.equal(catalog.versions.length,3);assert.equal(catalog.releases[0].state,'stopped')
 assert.equal((await app.call(`/api/training/projects/${p}/runs/${failed.id}`,{token:owner,status:200})).data.data.cases[0].checks.passed,false,'rollback preserves failing evidence')
 trace=(await app.call(`/api/ai-support/projects/${p}/conversations/${customer.conversationId}/trace`,{token:owner,status:200})).data.traces[0]
 assert.equal(trace.procedure.versionId,v2.id);assert.equal(trace.procedure.releaseState,'stopped')
 }finally{await a.close()}
}
