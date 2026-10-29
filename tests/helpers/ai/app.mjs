import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'
import {openaiStream,formatName} from '../openai-stream.mjs'
import {providerFixture} from './provider-fixtures.mjs'

export const model='gpt-5.6-luna'

// A workspace whose visitor assistant answers through the real queue and generation lifecycle.
// Only providers are fixtures: `ai.respond(body,request)` answers each OpenAI request with a
// Response, a structured object or text; other provider hosts answer with their protocol fixture;
// `ai.reject` makes every provider refuse with a server error; `ai.network(request)` answers other hosts.
export async function assistantApp({bindings={},prompt='Use evidence',assistantModel=model}={}){
 const ai={calls:[],before:null,reject:false,network:null,respond:()=>'Reply'}
 const app=await startApp({captureQueue:true,bindings:{OPENAI_API_KEY:'synthetic-hh-1',APP_ORIGIN:'https://support.example',...bindings},outbound:async request=>{
  const host=new URL(request.url).hostname
  if(ai.reject){ai.calls.push({host,rejected:true});return new Response(JSON.stringify({error:{message:'fixture rejected',type:'server_error'}}),{status:503,headers:{'content-type':'application/json'}})}
  if(ai.network&&host!=='api.openai.com')return ai.network(request)
  if(host!=='api.openai.com'){ai.calls.push({host});return providerFixture(host)}
  const body=await request.json();ai.calls.push({host,name:formatName(body),body});if(ai.before)await ai.before(body)
  const answer=await ai.respond(body,request);return answer instanceof Response?answer:openaiStream(answer,{input_tokens:5,output_tokens:2})
 }})
 const workspace=await app.seedWorkspace('ai',{allowedOrigin:'https://widget.example'}),p=workspace.projectId,owner=workspace.tokens.owner
 await app.db.batch([
  app.db.prepare("INSERT INTO ai_profiles(id,project_id,name,role,prompt,model,created_at) VALUES('ai',?,'Assistant','support',?,?,1)").bind(p,prompt,assistantModel),
  app.db.prepare('INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES(?,?,1)').bind(p,JSON.stringify({default_visitor_ai_id:'ai',default_responder:'ai'})),
 ])
 // Each independent visitor has its own network address. Shared-IP admission limits
 // remain enabled while the combined knowledge/provider journey creates many clients.
 let visitorIndex=0
 // A visitor on the widget with their own conversation; `say` admits a customer message at the current revision.
 const visitor=async(name='Visitor',identity={})=>{
  const headers={Origin:'https://widget.example','CF-Connecting-IP':`192.0.2.${++visitorIndex}`}
  const session=(await app.call('/api/identity/widget/session',{body:{...identity,widgetKey:workspace.widgetKey,name},headers,status:201})).data
  const conversation=(await app.call('/api/conversations',{token:session.token,headers,body:{projectId:p},status:201})).data
  const path=`/api/conversations/${conversation.id}/messages`,transcript=async()=>(await app.call(path,{token:session.token,headers,status:200})).data
  const say=async content=>{const current=await transcript();return (await app.call(path,{token:session.token,headers,body:{localId:crypto.randomUUID(),content,expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId},status:200})).data}
  return {...session,conversationId:conversation.id,transcript,say}
 }
 const generations=conversationId=>app.sql('SELECT * FROM ai_generations WHERE conversation_id=? ORDER BY rowid',conversationId)
 const run=async(jobs)=>{for(const job of jobs??await app.takeJobs())await app.runJobs([job])}
 const action=(conversationId,action,data,token=owner)=>app.call(`/api/dashboard/projects/${p}/conversations/${conversationId}/actions`,{token,body:{action,data}})
 return {app,ai,p,workspace,owner,visitor,generations,run,action,providerCalls:()=>ai.calls.length,close:()=>app.close()}
}
