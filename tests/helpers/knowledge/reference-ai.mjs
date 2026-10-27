import assert from 'node:assert/strict'
import {openaiStream,openaiToolCall} from '../openai-stream.mjs'

const tokenPattern=/⟦k:[a-f0-9]{32}⟧/u
const strings=value=>typeof value==='string'?[value]:value&&typeof value==='object'?Object.values(value).flatMap(strings):[]
function contextPacket(request){
 for(const text of strings(request.input)){
  const start=text.indexOf('{')
  if(start<0)continue
  let parsed;try{parsed=JSON.parse(text.slice(start))}catch{continue}
  if(Array.isArray(parsed.evidence?.conversation))return parsed
 }
 assert.fail('the real provider request must include the scoped conversation packet')
}
function toolOutput(request,callId){
 const output=request.input.find(item=>item.type==='function_call_output'&&item.call_id==='call-'+callId)
 assert.ok(output,'the real tool result reaches the next provider round')
 return JSON.parse(output.output)
}
function excludes(value,needles,label){
 const serialized=JSON.stringify(value)
 for(const needle of needles)assert.ok(!serialized.includes(needle),label)
 assert.doesNotMatch(serialized,tokenPattern,label+' contains no raw reference')
}

/** Real support generations, with fixtures only where the provider receives a request. */
export async function referenceAi({k,body,article,category,a,b,c,send,grants,call,app,p,insert,issued,mail}){
 const base=`/api/management/projects/${p}`,knowledge=`/api/knowledge/${p}`,conversationId=a.conversation.id
 const transcript=async customer=>(await app.call(`/api/conversations/${customer.conversation.id}/messages`,{token:customer.token,status:200})).data
 const api=async()=>(await app.call(`/api/v1/conversations/${conversationId}/messages`,{token:issued.token,status:200})).data
 const native=()=>transcript(a)
 const generation=id=>call(`/api/ai-support/projects/${p}/generations/${id}`,{status:200}).then(response=>response.data)
 const action=(action,data)=>call(`/api/dashboard/projects/${p}/conversations/${conversationId}/actions`,{body:{action,data},status:200})
 const originalKey=app.bindings.OPENAI_API_KEY,requests=[]
 const captureMail=async(request,entry)=>{
  assert.equal(new URL(request.url).hostname,'api.resend.com')
  mail.push(JSON.parse(entry.body));return Response.json({id:'mail-'+mail.length})
 }
 let answerProvider,participant
 k.provider=async(request,entry)=>{
  if(new URL(request.url).hostname==='api.resend.com')return captureMail(request,entry)
  assert.equal(new URL(request.url).hostname,'api.openai.com')
  const input=JSON.parse(entry.body);requests.push(input)
  assert.doesNotMatch(JSON.stringify(input),tokenPattern,'every provider round receives rendered references')
  return answerProvider(input)
 }
 try{
  await app.configure({OPENAI_API_KEY:'reference-ai-network-fixture'})
  await grants([a.contactId])
  const secondaryBody='The marigold validation ledger records a second approval after the designated reviewer confirms every restoration credential inside the protected inspection office.'
  const secondaryCategory=(await call(`${knowledge}/categories`,{body:{title:'Independent recovery evidence',audience:'selected'},status:201})).data.id
  const secondary=(await call(`${knowledge}/articles`,{body:{title:'Account restoration corroboration',slug:'restoration-corroboration',content:secondaryBody,categoryIds:[secondaryCategory],status:'published'},status:201})).data.id
  const secondaryGrants=ids=>call(`${knowledge}/categories/${secondaryCategory}/entitlements`,{method:'PUT',body:{required:true,contactIds:ids,companyIds:[]},status:200})
  await secondaryGrants([a.contactId])
  const inserted=await send(a,'Inserted evidence for the assistant: '+insert.token)
  assert.equal(inserted.status,200,JSON.stringify(inserted.data))
  const copied=await send(a,'Copied evidence for the assistant: '+body)
  assert.equal(copied.status,200,JSON.stringify(copied.data))
  const messageIds=[inserted.data.message.id,copied.data.message.id]
  const title=insert.preview.title,url=insert.preview.url
  assert.ok(title&&url,'the article insertion supplies its operator preview metadata')
  const projected=request=>{
   const history=contextPacket(request).evidence.conversation
   for(const id of messageIds){
    const entry=history.find(item=>item.id===id||item.evidence_id==='message:'+id)
    assert.ok(entry,'inserted and copied messages remain independently present in the model context')
    excludes(entry,[body,body.split('. ')[0]],'transcript references never become article bodies in a model input')
    assert.ok(entry.content.includes(title)&&entry.content.includes(url),'each inserted or copied reference renders its title and link for an entitled model audience')
   }
  }
  const profile=(await call(`${base}/ais`,{body:{name:'Reference evidence assistant',role:'support',prompt:'Use read-only knowledge retrieval for the recovery question.',model:'gpt-5.6-luna',is_enabled:true},status:201})).data.data
  await action('assignAi',{ai_id:profile.id})
  const run=async()=>{
   const frontier=(await call(`/api/conversations/${conversationId}`,{status:200})).data
   const response=await call(`/api/ai-support/projects/${p}/conversations/${conversationId}/generations`,{body:{expectedRevision:frontier.revision},status:202})
   await k.drain()
   return generation(response.data.id)
  }

  // The provider deliberately never calls cite_knowledge. The second search's
  // independently restricted source must still govern the entire final answer.
  const answer='I checked both recovery records. The coordinated review can proceed after the appointed specialists confirm the account details.'
  let turn=0,primarySource
  answerProvider=request=>{
   projected(request)
   if(++turn===1){
    excludes(request,[body,secondaryBody],'initial model context contains no knowledge bodies')
    return openaiToolCall('search_knowledge',{query:'indigo'},'reference-primary')
   }
   if(turn===2){
    const sources=toolOutput(request,'reference-primary');primarySource=sources.find(source=>source.id==='article:'+article)
    assert.ok(primarySource,'the entitled knowledge tool retrieves the original article')
    assert.equal(primarySource.content,body,'article bodies reach the model through the authorized knowledge tool')
    return openaiToolCall('search_knowledge',{query:'marigold'},'reference-uncited')
   }
   if(turn===3){
    const source=toolOutput(request,'reference-uncited').find(item=>item.id==='article:'+secondary)
    assert.ok(source,'the generation retrieves the separate uncited source')
    assert.equal(source.content,secondaryBody)
    return openaiToolCall('read_knowledge_source',{evidence_id:primarySource.id,sourceVersion:primarySource.sourceVersion,start_offset:0},'reference-read')
   }
   assert.equal(turn,4,'the fixture finishes after the real search and source-read rounds')
   assert.equal(toolOutput(request,'reference-read').content,body,'the issued publication can also be read through the bounded knowledge tool')
   return openaiStream(answer)
  }
  const completed=await run()
  assert.equal(completed.state,'completed',JSON.stringify(completed))
  assert.equal(turn,4,'all provider continuations were exercised')
  const aiMessage=(await native()).messages.find(message=>message.local_id==='generation:'+completed.id)
  assert.ok(aiMessage,'the real generation admits its answer into the customer transcript')
  assert.equal(aiMessage.content,answer)
  assert.deepEqual(JSON.parse(aiMessage.citations_json||'[]'),[],'the answer has no selected citations')
  assert.equal((await api()).data.find(message=>message.id===aiMessage.id).content,answer)

  // A keeps both grants. Adding C changes the model audience, so even the
  // requester's still-readable transcript cannot disclose knowledge to a model.
  const contact=(await call(`/api/dashboard/projects/${p}/conversations/${c.conversation.id}`,{status:200})).data.data.contact
  participant=(await call(`/api/dashboard/projects/${p}/conversations/${conversationId}/participants`,{body:{email:contact.email},status:201})).data.data
  let deniedTurns=0
  const deniedStart=requests.length
  answerProvider=request=>{
   excludes(request,[body,body.split('. ')[0],secondaryBody,answer],'every model round uses all current recipients, including an unentitled participant')
   if(++deniedTurns===1)return openaiToolCall('search_knowledge',{query:'indigo'},'reference-denied')
   assert.equal(deniedTurns,2)
   assert.deepEqual(toolOutput(request,'reference-denied'),[],'knowledge retrieval cannot issue the restricted source for the changed audience')
   return openaiStream('A teammate can help with your next question.')
  }
  await run()
  assert.equal(requests.length-deniedStart,2,'the changed audience was checked on initial and tool-continuation model requests')
  assert.equal((await native()).messages.find(message=>message.id===aiMessage.id).content,answer,'the entitled viewer retains their own authorized answer')
  excludes(await api(),[answer],'connected applications use every current recipient')
  await call(`/api/dashboard/projects/${p}/conversations/${conversationId}/participants/${participant.pivot.id}`,{method:'DELETE',status:200});participant=null

  // Revoking only the never-cited source proves that recording merely selected
  // citations, or only the transcript's original source, cannot satisfy this case.
  for(const [withdraw,restore,label] of [
   [()=>secondaryGrants([]),()=>secondaryGrants([a.contactId]),'uncited retrieved source'],
   [()=>grants([]),()=>grants([a.contactId]),'original retrieved source'],
  ]){
   await withdraw()
   const customer=await native(),connected=await api()
   assert.ok(customer.messages.some(message=>message.id===aiMessage.id),'withdrawal retains the answer’s message identity')
   assert.ok(connected.data.some(message=>message.id===aiMessage.id),'API withdrawal retains the answer’s message identity')
   excludes(customer,[answer],label+' withdrawal hides the old AI output on the native customer door')
   excludes(connected,[answer],label+' withdrawal hides the old AI output on the API door')
   assert.ok(customer.messages.some(message=>message.content.includes('Copied evidence for the assistant:')),'ordinary operator words remain visible when a reference is withheld')
   await restore()
   assert.equal((await native()).messages.find(message=>message.id===aiMessage.id).content,answer,label+' re-grant restores the exact pinned output')
   assert.equal((await api()).data.find(message=>message.id===aiMessage.id).content,answer,label+' re-grant restores the pinned output through the API')
  }
 }finally{
  if(participant)await call(`/api/dashboard/projects/${p}/conversations/${conversationId}/participants/${participant.pivot.id}`,{method:'DELETE',status:200})
  k.provider=captureMail
  await app.configure({OPENAI_API_KEY:originalKey})
 }
}
