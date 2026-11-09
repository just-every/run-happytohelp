import assert from 'node:assert/strict'
import {inboxExactness} from './inbox-exact.mjs'

// Extend the same replacement request's public-door proof, without another test leaf.
export async function deskQueueProof(f,{second,tag,field,foreignVisitor,foreignTicket}){
 const {app,w,foreign,id,ok,call,get,patch,visitor}=f
 const original=await get(id),originalSecond=await get(second),ids=rows=>rows.map(row=>row.id).sort()
 const companies=`/api/management/projects/${w.projectId}/companies`,company=(await app.ok(companies,{token:w.tokens.owner,body:{name:'Ridgeline buyers'}})).company.id
 // A second tag on the second ticket, so any, all and none of two tags each have their own answers.
 const pair=await ok(`/conversations/${second}/tags`,{name:'Seam'}),moment=(await app.first('SELECT created_at FROM conversations WHERE id=?',second)).created_at
 const exact=inboxExactness(app,w,{tag,company,pair,field:field.id,moment})
 await ok(`/conversations/${id}`,{agent_id:w.users.operator},'owner','PUT')
 await ok(`/conversations/${second}`,{agent_id:null},'owner','PUT')
 await exact('assigned')
 const list=async(query,project=true,token=w.tokens.operator)=>(await app.ok((project?`/api/dashboard/projects/${w.projectId}`:'/api/dashboard')+'/conversations?'+new URLSearchParams(query),{token})).data
 const selected=rows=>ids(rows).filter(key=>[id,second].includes(key))
 const opening='Order TO-48200: the Ridgeline boot has a torn seam. Can you arrange a replacement?'
 // Contact writes keep the identity index current: an operator edit, a rename and an imported source id.
 const contact=visitor.contactId
 const contactPath=(project,key)=>`/api/management/projects/${project}/contacts/${key}`
 await app.ok(contactPath(w.projectId,contact),{token:w.tokens.owner,method:'PUT',body:{provided_email:'Dana.Personal+Boots@Example.test'}})
 await app.ok(contactPath(foreign.projectId,foreignVisitor.contactId),{token:foreign.tokens.owner,method:'PUT',body:{provided_email:'dana.personal+boots@example.test'}})
 await app.db.prepare("INSERT INTO move_in_conversations(conversation_id,project_id,vendor,source_id,subject,source_state,source_channel) VALUES(?,?,'zendesk','771203','Torn seam','open','web')").bind(second,w.projectId).run()
 await app.ok(`/api/conversations/${foreignTicket.id}/messages`,{token:foreignVisitor.token,body:{localId:'foreign-same-words',content:opening,expectedRevision:0}})
 for(const project of [true,false]){
  const word=await list({search:'TO-48200'},project)
  assert.deepEqual(ids(word),[id],'retained message search excludes the other order and foreign tenant')
  assert.equal(word[0].matched_message.content,opening,'the preview shows the older matching request, not the latest reply')
  assert.notEqual(word[0].last_message.content,opening)
  assert.deepEqual(ids(await list({search:'"Order TO-48200"'},project)),[id])
  assert.deepEqual(ids(await list({search:'"TO-48200 Order"'},project)),[],'quoted phrases preserve word order')
  assert.deepEqual(ids(await list({search:'seam TO-48200'},project)),[id],'unquoted words can occur apart and out of order')
  assert.deepEqual(ids(await list({search:'DANA.WHITFIELD@EXAMPLE.TEST'},project)),[id,second].sort(),'identity matching is case insensitive')
  assert.deepEqual(ids(await list({search:'Dana Whit'},project)),[id,second].sort())
  for(const literal of ['%','_','OR','content:missing'])assert.deepEqual(ids(await list({search:literal},project)),[],literal+' is literal, never wildcard or FTS syntax')
  // Three or more characters read the contact trigram index; shorter terms keep the per-conversation substring test.
  for(const term of ['na Whitf','ELD@EXAMPLE.T','PERSONAL+BOOTS@','W','@'])assert.deepEqual(selected(await list({q:term},project)),[id,second].sort(),term+' matches the contact identity')
  assert.deepEqual(selected(await list({q:'Whitfield Dana'},project)),[],'identity is one substring, not words in any order')
  for(const term of ['#771203','771203'])assert.deepEqual(ids(await list({search:term},project)),[second],term+' finds the imported ticket')
  assert.deepEqual(selected(await list({view:'open'},project)),[id,second].sort())
  assert.deepEqual(selected(await list({view:'closed'},project)),[])
  assert.deepEqual(selected(await list({view:'mine'},project)),[id])
  assert.deepEqual(selected(await list({view:'mine'},project,w.tokens.owner)),[])
  assert.deepEqual(selected(await list({view:'unassigned'},project)),[second])
 }
 assert.deepEqual(selected(await list({view:'open',tag:tag.id})),[id])
 assert.deepEqual(ids(await list({q:'personal+boots'},false,foreign.tokens.operator)),[foreignTicket.id],'the foreign operator finds only their own contact')
 await app.ok(contactPath(w.projectId,contact),{token:w.tokens.owner,method:'PUT',body:{name:'Dana Fairweather'}})
 for(const project of [true,false])assert.deepEqual(selected(await list({q:'fairweath'},project)),[id,second].sort(),'a renamed contact is found by its new name')
 await app.ok(contactPath(w.projectId,contact),{token:w.tokens.owner,method:'PUT',body:{name:'Dana Whitfield',provided_email:null}})
 await app.db.prepare('DELETE FROM move_in_conversations WHERE conversation_id=?').bind(second).run()
 for(const project of [true,false]){
  assert.deepEqual(selected(await list({q:'Fairweather'},project)),[],'the old name is no longer found')
  assert.deepEqual(selected(await list({q:'personal+boots'},project)),[],'a cleared provided email is no longer found')
  assert.deepEqual(selected(await list({q:'Dana Whit'},project)),[id,second].sort())
 }
 // D1's overload answer: any read is retried as a whole, then answers 503 with Retry-After, never 500.
 const overloaded=(path,headers)=>app.call(path,{token:w.tokens.operator,headers:{'x-test-fault':'d1-overloaded',...headers}})
 const busy=async(path,at)=>{
  const answer=await overloaded(path,at)
  assert.equal(answer.status,503,path+' '+JSON.stringify(answer.data));assert.equal(typeof answer.data.error,'string')
  const wait=Number(answer.headers.get('retry-after'));assert.ok(Number.isInteger(wait)&&wait>=1&&wait<=30,'Retry-After is whole seconds within D1\'s window')
 }
 const searchPath=`/api/dashboard/projects/${w.projectId}/conversations?`+new URLSearchParams({q:'TO-48200'})
 const recovered=await overloaded(searchPath,{'x-test-overloads':'2'})
 assert.equal(recovered.status,200);assert.deepEqual(ids(recovered.data.data),[id],'a passing overload is retried to the same result')
 for(const at of [{},{'x-test-statement':'inbox_search_total'}])await busy(searchPath,at)
 // An unsearched page (a view, and a subject and tags filter read from migration 319's index and counts), the counts
 // and a conversation, at the first D1 call and a later one.
 const shaped=`/api/dashboard/projects/${w.projectId}/conversations?`+new URLSearchParams({filters:JSON.stringify([{field:'subject',operator:'contains',value:'TO-48200'},{field:'tags',operator:'in',value:[tag.id,pair.id]}])})
 for(const path of [`/api/dashboard/projects/${w.projectId}/conversations?view=open`,shaped,'/api/dashboard/conversations?view=all',`/api/dashboard/projects/${w.projectId}/conversations/counts`,`/api/dashboard/projects/${w.projectId}/conversations/${id}`]){
  const calm=await app.call(path,{token:w.tokens.operator})
  for(const at of ['1','4']){
   const passing=await overloaded(path,{'x-test-statement-at':at,'x-test-overloads':'2'})
   assert.equal(passing.status,200,path);assert.deepEqual(passing.data,calm.data,path+' answers the same after a passing overload')
   await busy(path,{'x-test-statement-at':at})
  }
 }
 // The integration API has its own error handler; an overload there follows the same rule, in its own error shape.
 const reader=(await app.ok(`/api/management/projects/${w.projectId}/connections/tokens`,{token:w.tokens.owner,body:{name:'Overload reader',scopes:['conversations:read']}})).token
 const apiPath=`/api/v1/conversations/${id}`,apiCalm=await app.call(apiPath,{token:reader})
 assert.equal(apiCalm.status,200,JSON.stringify(apiCalm.data))
 // The first D1 call is the application's own middleware; the token lookup is inside the API's router.
 for(const at of [{'x-test-statement-at':'1'},{'x-test-statement':'integration_tokens'}]){
  const fault={'x-test-fault':'d1-overloaded',...at}
  const passing=await app.call(apiPath,{token:reader,headers:{...fault,'x-test-overloads':'2'}})
  assert.equal(passing.status,200);assert.deepEqual(passing.data,apiCalm.data,'the API answers the same after a passing overload')
  const refused=await app.call(apiPath,{token:reader,headers:fault})
  assert.equal(refused.status,503,JSON.stringify(refused.data));assert.ok(refused.data.error)
  if(at['x-test-statement'])assert.equal(refused.data.error.code,'unavailable','the API answers in its own error shape')
  const wait=Number(refused.headers.get('retry-after'));assert.ok(Number.isInteger(wait)&&wait>=1&&wait<=30)
 }
 await patch(id,{status_id:'solved'})
 await exact('resolved')
 assert.deepEqual(selected(await list({view:'closed'})),[id])
 assert.deepEqual(selected(await list({view:'open'})),[second])
 assert.deepEqual(ids(await list({view:'open',search:'TO-48200'})),[id],'search defaults to retained history, including solved tickets')
 assert.deepEqual(ids(await list({view:'open',search_scope:'view',search:'TO-48200'})),[],'explicit current-view search respects status')
 await patch(id,{status_id:original.status_id})
 await exact('reopened')
 const ai=(await app.ok(`/api/management/projects/${w.projectId}/ais`,{token:w.tokens.owner,body:{name:'Replacement assistant',role:'support',prompt:'Review replacements',model:'gpt-5.6-luna'}})).data
 await app.configure({OPENAI_API_KEY:'synthetic-desk-provider-key'})
 await ok(`/conversations/${second}/actions`,{action:'assignAi',data:{ai_id:ai.id}})
 assert.deepEqual(selected(await list({view:'ai'})),[second])
 assert.deepEqual(selected(await list({view:'open'})),[id],'AI work is separate from the human queue')
 await exact('given an AI')
 await ok(`/conversations/${second}/actions`,{action:'assignAi',data:{ai_id:null}})
 assert.deepEqual(selected(await list({view:'ai'})),[])
 await exact('AI removed')
 await app.configure({OPENAI_API_KEY:undefined})
 await app.ok(`/api/management/projects/${w.projectId}/ais/${ai.id}`,{token:w.tokens.owner,method:'DELETE'})
 // Tags, a snooze and its wake, a merge and its undo, a note on a widget draft and reads keep every view exact.
 await patch(second,{tags_add:[tag.id]});await exact('tagged')
 await patch(second,{tags_remove:[tag.id]});await exact('untagged')
 // The customer's company link follows into the company filter, and its removal out of it.
 const member=`${companies}/${company}/members/${visitor.contactId}`
 await app.ok(member,{token:w.tokens.owner,method:'PUT',body:{}})
 assert.deepEqual(selected(await list({view:'all',company})),[id,second].sort());await exact('linked to a company')
 await app.ok(member,{token:w.tokens.owner,method:'DELETE'})
 assert.deepEqual(selected(await list({view:'all',company})),[]);await exact('unlinked from the company')
 const current=await get(second)
 const snooze=await ok('/workflow-schedules',{conversation_id:second,kind:'snooze',due_at:Date.now()+86400000,timezone:'UTC',owner_id:w.users.owner,expected_revision:current.revision,expected_last_message_id:current.last_message_id,expected_ticket_version:current.ticket_version})
 await exact('snoozed')
 await ok(`/workflow-schedules/${snooze.id}`,{action:'cancel'},'owner','PATCH')
 await exact('snooze cancelled')
 // Two more of the customer's widget drafts carry the rest, so this request's own history stays as it is.
 const draft=async()=>(await app.ok('/api/conversations',{body:{projectId:w.projectId,contactId:visitor.contactId},token:w.tokens.owner})).id
 const write=async(ticket,localId,content)=>app.ok(`/api/conversations/${ticket}/messages`,{token:visitor.token,body:{localId,content,expectedRevision:(await app.ok(`/api/conversations/${ticket}`,{token:visitor.token})).revision}})
 const noted=await draft(),other=await draft()
 const note=await ok(`/conversations/${noted}/notes`,{content:'Called the customer about a second boot.'})
 await exact('a widget draft with a note')
 assert.equal((await call(`/conversations/${noted}/notes/${note.id}`,undefined,'owner','DELETE')).status,200)
 await exact('the note removed')
 await write(noted,'draft-question','One more boot arrived with a torn seam.');await write(other,'draft-follow-up','And the laces are missing.')
 await exact('the customer writes on two drafts')
 for(const role of ['owner','operator'])await ok(`/conversations/${noted}/actions`,{action:'markAsRead',data:{}},role)
 await exact('read')
 const merged=await ok(`/conversations/${noted}/merge`,{source_id:other,source_version:(await get(other)).ticket_version,target_version:(await get(noted)).ticket_version})
 await exact('merged')
 assert.equal((await ok(`/conversations/${noted}/merges/${merged.id}/undo`,{})).undone,true)
 await exact('merge undone')
 await patch(second,{tags_remove:[pair.id]});await exact('the second tag removed')
 await ok(`/conversations/${id}`,{agent_id:original.assigned_to||null},'owner','PUT')
 await ok(`/conversations/${second}`,{agent_id:originalSecond.assigned_to||null},'owner','PUT')
 const transcript=await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token})
 const attachment=transcript.messages.flatMap(message=>message.media||[]).find(file=>file.filename==='return-label.txt')
 assert.ok(attachment,'the reviewed replacement reply carries its real label')
 const media=`/api/conversations/${id}/media/${attachment.id}`
 for(const token of [visitor.token,w.tokens.operator]){
  const response=await app.request(media,{token})
  assert.equal(response.status,200);assert.equal(await response.text(),'Return label bytes')
 }
 for(const token of [foreign.tokens.operator,foreignVisitor.token]){
  for(const path of [`/api/conversations/${id}/messages`,media,`/api/dashboard/projects/${w.projectId}/conversations/${id}`]){
   const response=await app.request(path,{token})
   assert.ok([403,404].includes(response.status),path+' refuses foreign authority')
   assert.doesNotMatch(await response.text(),/Return label bytes|TO-48200|Dana/)
  }
 }
 assert.deepEqual(ids(await list({search:'TO-48200'},false,foreign.tokens.operator)),[foreignTicket.id],'the foreign operator sees only their own matching request')
 const tooLong=await app.call(`/api/dashboard/projects/${w.projectId}/conversations?search=`+'x'.repeat(201),{token:w.tokens.operator})
 assert.equal(tooLong.status,400);assert.match(JSON.stringify(tooLong.data),/at most 200 characters/)
}
