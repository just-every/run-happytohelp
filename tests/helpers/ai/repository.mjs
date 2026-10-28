import assert from 'node:assert/strict'
import {assistantApp} from './app.mjs'
import {openaiToolCall} from '../openai-stream.mjs'

const repo='just-every/run-happytohelp',tools=body=>(body.tools||[]).map(tool=>tool.name)
const read=(repository,path,id)=>openaiToolCall('repo_read_file',{repository,path,ref:'main',start_offset:0,expected_sha:null},id)

// With repositories selected for operators, the assistant reads only allowed repository files as redacted,
// attributed evidence that suggestions can cite; secrets files, other repositories and visitor replies get nothing.
export async function repositoryJourney(a,v){
 const {app,ai,p,owner}=a
 try{
  await app.configure({GITHUB_TOKENS:JSON.stringify({[p]:'synthetic-mapped-installation-token'})})
  // GitHub is a fixture at the network edge: one file whose content holds a secret.
  const fetched=[];ai.network=async request=>{fetched.push(new URL(request.url).pathname);assert.match(request.url,/^https:\/\/api\.github\.com\/repos\/just-every\/run-happytohelp\/contents\/src\/app\.ts/)
   return Response.json({type:'file',encoding:'base64',size:60,sha:'sha1',html_url:`https://github.com/${repo}/blob/sha1/src/app.ts`,content:btoa('const api_key = "private-token";\nexport const ok = true')})}
  await app.call(`/api/management/projects/${p}/github`,{token:owner,method:'PUT',body:{repositories:[repo],allow_agents:true,allow_contacts:false},status:200})
  // A visitor reply is not offered repository tools when repositories are not shared with contacts.
  const visitor=await a.visitor();ai.respond=()=>'A reply';await visitor.say('Hello');await a.run();assert.ok(!tools(ai.calls.at(-1).body).some(name=>name.startsWith('repo_')))
  await v.say('Why does checkout fail?');await app.takeJobs()
  let turn=0,evidence
  ai.respond=body=>{
   if(body.text?.format?.name==='agent_suggestion_alternatives')return {alternatives:[],missing_information:[]}
   turn++;assert.ok(tools(body).includes('repo_read_file'),'operators get repository reads')
   if(turn===1)return read(repo,'src/app.ts','read')
   if(turn===2)return read(repo,'.env','secret')
   if(turn===3)return read('other/repo','src/app.ts','foreign')
   const input=JSON.stringify(body.input);evidence=input.match(/repo:just-every\/run-happytohelp:sha1:src\/app\.ts/)?.[0]
   assert.ok(evidence,'the read returns its exact evidence id');assert.match(input,/REDACTED/);assert.ok(!input.includes('private-token'),'repository secrets are redacted before the model')
   return {user_goal:'Explain checkout',responses:[{button:'Explain',icon:'circle-question-mark',response:'Checkout reads the app configuration.',use_when:'',evidence_ids:[evidence]}],missing_information:[]}
  }
  assert.equal((await a.action(v.conversationId,'agentAssist',{options:{request_id:crypto.randomUUID()}})).status,202);await a.run()
  const generation=(await a.generations(v.conversationId)).at(-1);assert.equal(generation.state,'completed',generation.error)
  assert.deepEqual(JSON.parse(generation.output_json).result.responses[0].evidence_ids,[evidence],'the suggestion cites the repository evidence')
  assert.deepEqual(fetched,[`/repos/${repo}/contents/src/app.ts`],'.env and other repositories are never fetched')
  // Once repositories are no longer shared with operators, no repository tool is offered.
  await app.call(`/api/management/projects/${p}/github`,{token:owner,method:'PUT',body:{repositories:[repo],allow_agents:false,allow_contacts:false},status:200})
  ai.respond=body=>{assert.ok(!tools(body).some(name=>name.startsWith('repo_')));return body.text?.format?.name==='agent_suggestion_alternatives'?{alternatives:[],missing_information:[]}:{user_goal:'Help',responses:[{button:'Help',icon:'circle-question-mark',response:'Help',use_when:'',evidence_ids:[JSON.stringify(body).match(/message:[0-9a-f-]{36}/)[0]]}],missing_information:[]}}
  await a.action(v.conversationId,'agentAssist',{options:{request_id:crypto.randomUUID()}});await a.run();assert.equal((await a.generations(v.conversationId)).at(-1).state,'completed')
 }finally{ai.network=null}
}
