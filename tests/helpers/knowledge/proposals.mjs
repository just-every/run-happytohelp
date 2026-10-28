import assert from 'node:assert/strict'
import {createHmac,createHash} from 'node:crypto'
import {openaiToolCall,openaiStream} from '../openai-stream.mjs'
import {model} from '../ai/app.mjs'
import {knowledgeApp} from './app.mjs'
export async function proposalsJourney(){
 const k=await knowledgeApp({bindings:{OPENAI_API_KEY:'synthetic-happytohelp-18'}}),{app,p,call}=k
 try{
 const secret=(await app.first('SELECT verification_secret FROM projects WHERE id=?',p)).verification_secret
 const widget=async email=>(await app.call('/api/identity/widget/session',{body:{widgetKey:'widget-p',name:'Alice Example',identifier:email,email,contact_hash:createHmac('sha256',secret).update(email).digest('hex')},status:201})).data
 const customer=await widget('alice@trusted.test'),next=await widget('reader@trusted.test'),forbidden=await widget('reader@other.test')
 const cid=(await app.call('/api/conversations',{token:customer.token,body:{projectId:p},status:201})).data.id
 const messages=`/api/conversations/${cid}/messages`,transcript=()=>app.call(messages,{token:customer.token,status:200}).then(r=>r.data)
 let t=await transcript();await app.call(messages,{token:customer.token,body:{localId:crypto.randomUUID(),content:'How do I repair an export?',expectedRevision:t.revision,expectedLastMessageId:t.lastMessageId},status:200})
 t=await transcript()
 const quote='Alice Example: select UTF-8 export encoding. Contact alice@trusted.test; api_key=synthetic-happytohelp-17'
 const reply=(await app.call(messages,{token:k.token,body:{localId:crypto.randomUUID(),content:quote,expectedRevision:t.revision,expectedLastMessageId:t.lastMessageId},status:200})).data.message
 await app.call(`/api/dashboard/projects/${p}/conversations/${cid}`,{token:k.token,method:'PUT',body:{resolved:true},status:200})
 const r=await app.first('SELECT id FROM conversation_resolutions WHERE conversation_id=? ORDER BY ordinal DESC LIMIT 1',cid)
 await app.call(`/api/conversations/${cid}/widget-events`,{token:customer.token,body:{action:'rateResolution',data:{resolutionId:r.id,value:1}},status:200})
 const category=(await call(`/api/knowledge/${p}/categories`,{body:{title:'Trusted private guidance',audience:'domains',allowedDomains:['trusted.test']},status:201})).data.id
 const publicCategory=(await call(`/api/knowledge/${p}/categories`,{body:{title:'Public'},status:201})).data.id
 const body={conversationId:cid,resolutionId:r.id,messageId:reply.id,categoryId:category,title:'Export repair',quote}
 assert.equal((await call(`/api/knowledge/${p}/proposals`,{body:{sourceMessageOnly:true},status:400})).status,400)
 const sources=(await call(`/api/knowledge/${p}/proposals/sources`,{status:200})).data
 const picked=sources.cases.find(c=>c.resolutionId===r.id);assert.equal(picked.conversationId,cid);assert.ok(picked.privateCollectionIds.includes(category));assert.doesNotMatch(picked.messages.find(m=>m.id===reply.id).preview,/Alice|alice@|synthetic-happytohelp-17/)
 assert.equal((await app.call(`/api/knowledge/${p}/proposals/sources`,{token:customer.token})).status,403)
 await app.call(`/api/knowledge/public/${p}/search?q=encoding&locale=en`,{status:200})
 assert.ok((await call(`/api/knowledge/${p}/gaps`,{status:200})).data.searchTopics.some(g=>g.topic==='encoding'&&g.occurrences===1))
 assert.equal((await call(`/api/knowledge/${p}/proposals`,{body:{...body,categoryId:publicCategory}})).status,409,'customer-derived drafts cannot silently become public knowledge')
 await call(`/api/knowledge/${p}/experience`,{method:'PUT',body:{defaultLocale:'en',locales:['en','fr'],templates:{}},status:200})
 assert.equal((await call(`/api/knowledge/${p}/proposals`,{body:{...body,locale:'fr'}})).status,400,'a source draft cannot be mislabeled as a reviewed translation')
 await app.db.batch([
 app.db.prepare("INSERT INTO ai_profiles(id,project_id,name,role,prompt,model,created_at) VALUES('knowledge-proposal-ai',?,'Support','support','Use approved knowledge',?,1)").bind(p,model),
 app.db.prepare(`INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES(?,json_object('default_visitor_ai_id','knowledge-proposal-ai','default_verified_user_ai_id','knowledge-proposal-ai','default_responder','knowledge-proposal-ai'),1) ON CONFLICT(project_id) DO UPDATE SET settings_json=json_set(settings_json,'$.default_visitor_ai_id','knowledge-proposal-ai','$.default_verified_user_ai_id','knowledge-proposal-ai','$.default_responder','knowledge-proposal-ai')`).bind(p)])
 // Operator-requested model work may prepare a cited private draft, but cannot publish it.
 const workspaceConversation=(await app.call('/api/conversations',{token:next.token,body:{projectId:p},status:201})).data.id
 await app.call(`/api/dashboard/projects/${p}/conversations/${workspaceConversation}/actions`,{token:k.token,body:{action:'assignAi',data:{ai_id:null}},status:200})
 const instructionMessage=(await app.call(`/api/conversations/${workspaceConversation}/messages`,{token:next.token,body:{localId:crypto.randomUUID(),content:'Prepare a private knowledge draft from the verified export case for editor review.',expectedRevision:0},status:200})).data.message
 let proposalTurn=0
 const draftingProvider=async request=>{
  const input=await request.json(),names=(input.tools||[]).map(t=>t.name)
  assert.ok(names.includes('read_verified_resolution')&&names.includes('propose_knowledge_change'))
  assert.ok(!names.some(n=>/publish/.test(n)),'the model cannot publish a draft')
  if(input.text?.format?.name==='agent_suggestion_alternatives')return openaiStream({alternatives:[{button:'Review scope',icon:'circle-question-mark',response:'Review the draft’s private collection and source evidence.',use_when:'',evidence_ids:['message:'+instructionMessage.id]}],missing_information:[]})
  if(++proposalTurn===1)return openaiToolCall('read_verified_resolution',{resolutionId:r.id},'read-resolution')
  if(proposalTurn===2){const output=JSON.stringify(input.input.filter(item=>item.type==='function_call_output'));assert.match(output,/UTF-8 export encoding/);assert.doesNotMatch(output,/Alice Example|alice@trusted.test|synthetic-happytohelp-17/);return openaiToolCall('propose_knowledge_change',{resolutionId:r.id,messageId:reply.id,categoryId:category,title:'Export repair'},'propose-knowledge')}
  return openaiStream({user_goal:'Prepare reviewed knowledge',responses:[{button:'Review draft',icon:'circle-question-mark',response:'A private sourced draft is ready for named editorial review.',use_when:'',evidence_ids:['message:'+instructionMessage.id]}],missing_information:[]})
 }
 k.provider=draftingProvider
 const requestId=crypto.randomUUID(),assist=()=>app.call(`/api/dashboard/projects/${p}/conversations/${workspaceConversation}/actions`,{token:k.token,body:{action:'agentAssist',data:{options:{request_id:requestId,instructions:'Prepare a cited private knowledge draft from the selected verified resolution.'}}},status:202})
 const admitted=await assist();await k.drain()
 const prepared=(await call(`/api/knowledge/${p}/proposals`,{status:200})).data.proposals
 assert.equal(prepared.length,1);assert.equal(prepared[0].state,'draft');assert.equal((await app.first('SELECT count(*) n FROM knowledge_articles WHERE id=?',prepared[0].article_id)).n,0)
 assert.equal((await app.first('SELECT state FROM ai_generations WHERE id=?',admitted.data.id)).state,'completed')
 const beforeReplay=proposalTurn;assert.equal((await assist()).data.id,admitted.data.id);await k.drain();assert.equal(proposalTurn,beforeReplay,'repeated assistance never replays model drafting')
 const toolTrace=(await app.call(`/api/ai-support/projects/${p}/conversations/${workspaceConversation}/trace`,{token:k.token,status:200})).data.traces[0]
 assert.ok(toolTrace.toolTrace.calls.some(t=>t.toolName==='propose_knowledge_change'&&t.approval==='human-review-required'))
 // Revoking the exact requesting operator session withdraws the next tool call.
 proposalTurn=0
 const validProvider=draftingProvider
 k.provider=async request=>{
  const input=await request.clone().json()
  if(input.input.some(item=>item.type==='function_call'&&item.name==='read_verified_resolution'))await app.db.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').bind(Date.now(),createHash('sha256').update(k.owner.tokens.admin).digest('hex')).run()
  // Use the same protocol responses, with a fresh Request body for the fixture.
  return validProvider(request)
 }
 const withdrawn=(await app.call(`/api/dashboard/projects/${p}/conversations/${workspaceConversation}/actions`,{token:k.owner.tokens.admin,body:{action:'agentAssist',data:{options:{request_id:crypto.randomUUID(),instructions:'Prepare another private knowledge draft for review.'}}},status:202})).data
 await k.drain()
 assert.equal((await app.first('SELECT state FROM ai_generations WHERE id=?',withdrawn.id)).state,'superseded')
 assert.equal((await app.first("SELECT count(*) n FROM ai_tool_traces WHERE generation_id=? AND tool_name='propose_knowledge_change'",withdrawn.id)).n,0,'a revoked operator session cannot prepare or replay a draft')
 k.provider=validProvider
 const proposal=(await call(`/api/knowledge/${p}/proposals`,{body,status:201})).data
 assert.doesNotMatch(proposal.content,/Alice|alice@|synthetic-happytohelp-17/)
 assert.match(proposal.content,/UTF-8 export encoding/)
 assert.equal((await app.first('SELECT id FROM knowledge_articles WHERE id=?',proposal.articleId)),null,'drafting never publishes')
 const base=`/api/knowledge/${p}/proposals/${proposal.id}`
 await call(base+'/reject',{body:{reason:'Remove contact details and rewrite as general guidance.'},status:200})
 assert.equal((await call(base+'/publish',{body:{title:'Export repair',content:'Select UTF-8 export encoding.'}})).status,400)
 await call(base+'/publish',{body:{title:'Export repair',content:'Select UTF-8 export encoding.',slug:'export-repair',redactionReviewed:true},status:200})
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/export-repair`)).status,404)
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/export-repair`,{token:forbidden.token})).status,404)
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/export-repair`,{token:next.token,status:200})).data.content,'Select UTF-8 export encoding.')
 let result=(await call(`/api/knowledge/${p}/proposals`,{status:200})).data.proposals[0]
 assert.equal(result.reviewed_by,k.owner.users.owner);assert.equal(result.resolution_id,r.id);assert.equal(result.correctionRequired,false)
 assert.deepEqual(result.reviews.map(r=>r.state),['rejected','approved'],'editorial rejection remains available after publication')
 assert.equal((await call(`/api/knowledge/${p}/categories/${category}/audience`,{method:'PUT',body:{audience:'public',allowedDomains:[]}})).status,409)
 assert.equal((await call(`/api/knowledge/${p}/articles`,{body:{id:proposal.articleId,title:'Export repair',content:'Select UTF-8 export encoding.',categoryIds:[publicCategory],status:'published'}})).status,409,'ordinary article edits cannot bypass the private source scope')
 let turn=0
 k.provider=async request=>{assert.equal(new URL(request.url).hostname,'api.openai.com');const input=await request.json();if(++turn===1)return openaiToolCall('search_knowledge',{query:'export encoding'},'knowledge-search');if(turn===2){assert.match(JSON.stringify(input.input),/Select UTF-8 export encoding/);const version=(await app.first('SELECT publication_version FROM knowledge_articles WHERE id=?',proposal.articleId)).publication_version;return openaiToolCall('cite_knowledge',{sources:[{id:'article:'+proposal.articleId,sourceVersion:version}]},'knowledge-cite')}return openaiStream('Select UTF-8 export encoding.')}
 const nextCid=(await app.call('/api/conversations',{token:next.token,body:{projectId:p},status:201})).data.id
 const nextPath=`/api/conversations/${nextCid}/messages`,initial=(await app.call(nextPath,{token:next.token,status:200})).data
 await app.call(nextPath,{token:next.token,body:{localId:crypto.randomUUID(),content:'How do I choose export encoding?',expectedRevision:initial.revision,expectedLastMessageId:initial.lastMessageId},status:200})
 await k.drain()
 const answered=(await app.call(nextPath,{token:next.token,status:200})).data.messages.find(m=>m.actor_role==='ai')
 assert.ok(answered,JSON.stringify(await app.sql('SELECT id,state,error,options_json FROM ai_generations WHERE conversation_id=?',nextCid)))
 assert.equal(JSON.parse(answered.citations_json)[0].id,'article:'+proposal.articleId)
 await app.call(`/api/dashboard/projects/${p}/conversations/${nextCid}`,{token:k.token,method:'PUT',body:{resolved:true},status:200})
 result=(await call(`/api/knowledge/${p}/proposals`,{status:200})).data.proposals[0]
 assert.equal(result.outcomes.citedResolutionCycles,1);assert.equal(result.outcomes.reopened,0)
 await app.call(`/api/dashboard/projects/${p}/conversations/${nextCid}`,{token:k.token,method:'PUT',body:{resolved:false},status:200})
 result=(await call(`/api/knowledge/${p}/proposals`,{status:200})).data.proposals[0]
 assert.equal(result.correctionRequired,true);assert.equal(result.outcomes.reopened,1)
 for(let i=0;i<2;i++)assert.equal((await call(base+'/analyze-corrections',{body:{},status:200})).data.proposedCorrections.length,1)

 await call(base+'/publish',{body:{title:'Export repair',content:'Select UTF-8 export encoding and retry.',slug:'export-repair',redactionReviewed:true},status:200})
 result=(await call(`/api/knowledge/${p}/proposals`,{status:200})).data.proposals[0]
 assert.equal(result.outcomes.citedResolutionCycles,1);assert.equal(result.outcomes.reopened,1,'an edited article preserves earlier cited failure evidence')
 await app.call(`/api/dashboard/projects/${p}/conversations/${cid}`,{token:k.token,method:'PUT',body:{resolved:false},status:200})
 result=(await call(`/api/knowledge/${p}/proposals`,{status:200})).data.proposals[0]
 assert.equal(result.correctionRequired,true)
 for(let i=0;i<2;i++)assert.equal((await call(base+'/analyze-corrections',{body:{},status:200})).data.proposedCorrections.length,2)
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/export-repair`,{token:next.token,status:200})).data.content,'Select UTF-8 export encoding and retry.','a corrective proposal never silently changes guidance')
 await app.db.prepare("UPDATE contacts SET metadata_json=json_set(metadata_json,'$.is_erasing',1) WHERE id=?").bind(customer.contactId).run()
 assert.equal((await call(`/api/knowledge/${p}/proposals`,{status:200})).data.proposals.length,0)
 assert.equal((await app.call(`/api/knowledge/public/${p}/articles/export-repair`,{token:next.token})).status,404,'erasure removes source-derived articles and drafts')
 }finally{await k.close()}
}
