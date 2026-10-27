import assert from 'node:assert/strict'

// Exercise the public reply doors with server-prepared text and no client
// citations. Each fresh ticket has its own non-discardable compose fence.
export async function preparedReplyJourney(k,{category,article,customer,token}){
 const {app,p,call}=k,grants=`/api/knowledge/${p}/categories/${category}/entitlements`
 const grant=ids=>call(grants,{method:'PUT',body:{contactIds:ids},status:200})
 const machine=(await call(`/api/management/projects/${p}/connections/tokens`,{body:{name:'Knowledge reply acceptance',scopes:['conversations:read','messages:write']},status:201})).data.token
 const conversation=(await app.call('/api/conversations',{token,body:{projectId:p},status:201})).data.id
 for(const door of ['native','api','email','saved-reply'])for(const change of ['participant','revoke',...(door==='email'?['pending-cc']:[])]){
  await grant([customer])
  let content=(await call(`/api/knowledge/${p}/conversations/${conversation}/articles/${article}/insert`,{body:{mode:'text'},status:200})).data.text
  if(door==='saved-reply'){
   const base=`/api/management/projects/${p}`,macro=(await call(`${base}/macros`,{body:{title:'Restricted prepared reply',content,actions:{reply_type:'public'},scope:{visibility:'shared',roles:['owner'],groups:[],brands:[p]}},status:201})).data.data
   const current=await app.first('SELECT ticket_version FROM conversations WHERE id=?',conversation)
   await call(`${base}/macros/${macro.id}/apply`,{body:{version:macro.version,tickets:[{id:conversation,expected_version:current.ticket_version}],command_id:'knowledge-'+change},status:200})
   content=(await call(`${base}/conversations/${conversation}/macro-draft`,{status:200})).data.data.content
  }
  let participant
  if(change==='participant')participant=(await call(`/api/dashboard/projects/${p}/conversations/${conversation}/participants`,{body:{email:'unauthorized@other.test'},status:201})).data.data
  if(change==='revoke')await grant([])
  const current=await app.first('SELECT revision,last_message_id FROM conversations WHERE id=?',conversation)
  const body={localId:`prepared-${door}-${change}`,content,expectedRevision:current.revision,expectedLastMessageId:current.last_message_id,knowledgeSources:[]}
  const before=await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',conversation)
  const result=door==='api'?await app.call(`/api/v1/conversations/${conversation}/messages`,{token:machine,body}):door==='email'?await app.call('/api/integrations/email/inbound',{headers:{Authorization:'Bearer fixture-native-knowledge'},body:{messageId:`prepared-email-${change}`,to:'native-help@example.test',from:'owner-p@example.test',text:content,conversationId:conversation,...(change==='pending-cc'?{cc:['unauthorized-new@other.test']}:{})}}):await call(`/api/conversations/${conversation}/messages`,{body})
  assert.equal(result.status,409,`${door}/${change}: ${JSON.stringify(result.data)}`)
  assert.deepEqual(await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',conversation),before,`${door}/${change} admits no restricted content`)
  assert.equal(await app.first('SELECT 1 FROM conversation_outbox WHERE conversation_id=?',conversation),null,`${door}/${change} creates no delivery`)
  if(participant)await call(`/api/dashboard/projects/${p}/conversations/${conversation}/participants/${participant.pivot.id}`,{method:'DELETE',status:200})
 }
 await grant([customer])
 // Change authority after all observations but before the admitting statement.
 const prepared=(await call(`/api/knowledge/${p}/conversations/${conversation}/articles/${article}/insert`,{body:{mode:'text'},status:200})).data
 const result=await call(`/api/conversations/${conversation}/messages`,{body:{localId:'atomic-prepared-revocation',content:prepared.text,expectedRevision:0},headers:{'x-test-statement':'INSERT INTO messages','x-test-before-statement':`DELETE FROM knowledge_collection_entitlements WHERE project_id='${p}' AND category_id='${category}'`}})
 assert.equal(result.status,409,'revocation in the admitting statement cannot leak prepared text')
 assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',conversation)).n,0)
 await grant([customer])
}
