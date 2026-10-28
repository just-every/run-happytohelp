import assert from 'node:assert/strict'
import {assistantApp} from './app.mjs'
import {openaiToolCall} from '../openai-stream.mjs'

const evidence=body=>JSON.stringify(body).match(/message:[0-9a-f-]{36}/)?.[0]
const card=(button,response,body)=>({button,icon:'circle-question-mark',response,use_when:'',evidence_ids:[evidence(body)]})

// Operator assistance: suggestions and draft tools never send, run once per request id, and fail whole;
// handing a waiting conversation back to the assistant answers its turn once, within ceilings and authority.
export async function assistanceJourney(){
 const a=await assistantApp(),{app,ai,p,owner}=a
 const v=await a.visitor('Cancellation customer'),id=v.conversationId
 const assist=options=>a.action(id,'agentAssist',{options:{request_id:crypto.randomUUID(),...options}})
 const generation=id=>app.ok(`/api/ai-support/projects/${p}/generations/${id}`,{token:owner})
 const trace=async()=>(await app.ok(`/api/ai-support/projects/${p}/conversations/${id}/trace`,{token:owner})).generations
 try{
  await a.action(id,'assignAi',{ai_id:null});await app.takeJobs()
  assert.ok((await assist({})).status>=400,'an empty conversation supplies no invented evidence')
  ai.respond=()=>({user_goal:'Improve',responses:[{button:'Improved',icon:'circle-question-mark',response:'An improved draft.',use_when:'',evidence_ids:[]}],missing_information:[]})
  const draft=await assist({tool:'improve',message:'Unsent draft'});assert.equal(draft.status,202);await a.run()
  assert.equal((await v.transcript()).messages.length,0,'draft tools never send')
  await v.say('How do I cancel my order?');assert.deepEqual(await app.takeJobs(),[])

  // The same operator now asks for grounded repository evidence on this customer's question.
  const repository='just-every/run-happytohelp',fetched=[]
  await app.configure({GITHUB_TOKENS:JSON.stringify({[p]:'synthetic-mapped-installation-token'})})
  await app.call(`/api/management/projects/${p}/github`,{token:owner,method:'PUT',body:{repositories:[repository],allow_agents:true,allow_contacts:false},status:200})
  ai.network=async request=>{fetched.push(new URL(request.url).pathname);return Response.json({type:'file',encoding:'base64',size:60,sha:'synthetic-source',html_url:`https://github.com/${repository}/blob/synthetic-source/src/app.ts`,content:btoa('const api_key = "private-token";\nexport const ok = true')})}
  let turn=0,repoEvidence
  ai.respond=body=>{
   if(body.text?.format?.name==='agent_suggestion_alternatives')return {alternatives:[card('Confirmation','You will receive a cancellation email.',body)],missing_information:[]}
   if(++turn===1)return openaiToolCall('repo_read_file',{repository,path:'src/app.ts',ref:'main',start_offset:0,expected_sha:null},'read')
   if(turn===2)return openaiToolCall('repo_read_file',{repository,path:'.env',ref:'main',start_offset:0,expected_sha:null},'private')
   if(turn===3)return openaiToolCall('repo_read_file',{repository:'runeditrun/base',path:'src/app.ts',ref:'main',start_offset:0,expected_sha:null},'foreign')
   const input=JSON.stringify(body.input);assert.match(input,/REDACTED/);assert.doesNotMatch(input,/private-token/)
   repoEvidence=input.match(/repo:just-every\/run-happytohelp:synthetic-source:src\/app\.ts/)?.[0];assert.ok(repoEvidence)
   return {user_goal:'Cancel order',responses:[{...card('Cancel','Open Orders and choose Cancel.',body),evidence_ids:[repoEvidence]}],missing_information:[]}
  }
  const request_id=crypto.randomUUID(),first=await assist({request_id}),repeat=await assist({request_id})
  assert.equal(first.status,202);assert.equal(repeat.data.id,first.data.id)
  const jobs=await app.takeJobs();assert.equal(jobs.length,1);await a.run(jobs)
  const suggested=await generation(first.data.id);assert.equal(suggested.state,'completed')
  const responses=JSON.parse(suggested.output_json).result.responses
  assert.ok(responses.some(r=>r.evidence_ids.includes(repoEvidence)));assert.deepEqual(fetched,[`/repos/${repository}/contents/src/app.ts`])
  assert.equal((await v.transcript()).messages.length,1,'suggestions never send')
  const execution=(await trace()).find(r=>r.id===first.data.id)
  assert.equal(execution.committedAnswer,null);assert.ok(execution.usage.length>1);assert.ok(execution.usage.every(u=>u.inputTokens>0));assert.equal(execution.providerCostUsd,null)
  const calls=a.providerCalls();await a.run(jobs);assert.equal(a.providerCalls(),calls)

  // A later alternative request fails as a whole, leaving the earlier editable result intact.
  ai.respond=body=>body.text?.format?.name==='agent_suggestion_alternatives'?new Response(JSON.stringify({error:{message:'second stage rejected'}}),{status:503}):{user_goal:'Cancel',responses:[card('Review','Please review the cancellation.',body)],missing_information:[]}
  const failed=await assist({});await a.run();assert.notEqual((await generation(failed.data.id)).state,'completed')
  assert.equal(JSON.parse((await generation(failed.data.id)).output_json||'{}').result,undefined)
  const current=await v.transcript(),command={localId:crypto.randomUUID(),content:'I checked the cancellation instructions for you.',authoring:{kind:'ai',generationId:first.data.id,selection:0},expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId,resolve:true}
  await app.call(`/api/conversations/${id}/messages`,{token:owner,body:command,status:200})
  assert.equal((await app.call(`/api/conversations/${id}/messages`,{token:owner,body:command,status:200})).data.duplicate,true)
  const resolved=(await v.transcript()).resolution,adopted=(await trace()).find(r=>r.id===first.data.id)
  assert.equal(adopted.contribution,'adopted suggestion');assert.equal(adopted.customerOutcome.cycle.id,resolved.id);assert.equal(adopted.customerOutcome.cycle.attribution,'assisted')

  await v.say('Can you clarify the timing?');await app.takeJobs()
  ai.respond=body=>{assert.ok(!body.tools.some(t=>t.name.startsWith('repo_')),'private operator repositories never reach visitor replies');return 'The cancellation email follows shortly.'}
  const before=a.providerCalls()
  await a.action(id,'assignAi',{ai_id:'ai'});await a.action(id,'assignAi',{ai_id:'ai'})
  await a.run();await a.run();assert.equal(a.providerCalls(),before+1)
  assert.equal((await v.transcript()).messages.filter(m=>m.actor_role==='ai').length,1)
 }finally{await a.close()}
}
