import assert from 'node:assert/strict'

// Extend the same replacement request's public-door proof, without another test leaf.
export async function deskQueueProof(f,{second,tag,foreignVisitor,foreignTicket}){
 const {app,w,foreign,id,ok,get,patch,visitor}=f
 const original=await get(id),originalSecond=await get(second),ids=rows=>rows.map(row=>row.id).sort()
 await ok(`/conversations/${id}`,{agent_id:w.users.operator},'owner','PUT')
 await ok(`/conversations/${second}`,{agent_id:null},'owner','PUT')
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
 // D1's overload answer: a search is retried as a whole, then answers 503 with Retry-After, never 500.
 const searchPath=`/api/dashboard/projects/${w.projectId}/conversations?`+new URLSearchParams({q:'TO-48200'})
 const overloaded=headers=>app.call(searchPath,{token:w.tokens.operator,headers:{'x-test-fault':'d1-overloaded',...headers}})
 const recovered=await overloaded({'x-test-overloads':'2'})
 assert.equal(recovered.status,200);assert.deepEqual(ids(recovered.data.data),[id],'a passing overload is retried to the same result')
 for(const at of [{},{'x-test-statement':'inbox_search_total'}]){
  const busy=await overloaded(at)
  assert.equal(busy.status,503,JSON.stringify(busy.data));assert.equal(typeof busy.data.error,'string')
  const wait=Number(busy.headers.get('retry-after'));assert.ok(Number.isInteger(wait)&&wait>=1&&wait<=30,'Retry-After is whole seconds within D1\'s window')
 }
 await patch(id,{status_id:'solved'})
 assert.deepEqual(selected(await list({view:'closed'})),[id])
 assert.deepEqual(selected(await list({view:'open'})),[second])
 assert.deepEqual(ids(await list({view:'open',search:'TO-48200'})),[id],'search defaults to retained history, including solved tickets')
 assert.deepEqual(ids(await list({view:'open',search_scope:'view',search:'TO-48200'})),[],'explicit current-view search respects status')
 await patch(id,{status_id:original.status_id})
 const ai=(await app.ok(`/api/management/projects/${w.projectId}/ais`,{token:w.tokens.owner,body:{name:'Replacement assistant',role:'support',prompt:'Review replacements',model:'gpt-5.6-luna'}})).data
 await app.configure({OPENAI_API_KEY:'synthetic-desk-provider-key'})
 await ok(`/conversations/${second}/actions`,{action:'assignAi',data:{ai_id:ai.id}})
 assert.deepEqual(selected(await list({view:'ai'})),[second])
 assert.deepEqual(selected(await list({view:'open'})),[id],'AI work is separate from the human queue')
 await ok(`/conversations/${second}/actions`,{action:'assignAi',data:{ai_id:null}})
 assert.deepEqual(selected(await list({view:'ai'})),[])
 await app.configure({OPENAI_API_KEY:undefined})
 await app.ok(`/api/management/projects/${w.projectId}/ais/${ai.id}`,{token:w.tokens.owner,method:'DELETE'})
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
