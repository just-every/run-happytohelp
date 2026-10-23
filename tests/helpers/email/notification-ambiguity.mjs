import assert from 'node:assert/strict'

export async function notificationAmbiguity({app,fixture,original,apply,receive,imports,token}){
 const rows=original.split('\n').filter(Boolean).map(JSON.parse)
 if(fixture.vendor==='helpscout'){
  const conversation=structuredClone(rows[1]),page=structuredClone(rows[2]),previous=conversation.id
  conversation.id+=10000
  page._links.self.href=page._links.self.href.replace(`/conversations/${previous}/`,`/conversations/${conversation.id}/`)
  rows.push(conversation,page)
 }else{
  const source=rows.find(row=>row.ticket||row.type==='conversation'),copy=structuredClone(source),ticket=copy.ticket??copy
  ticket.id=fixture.vendor==='intercom'?ticket.id+'-ambiguous':ticket.id+10000
  rows.push(copy)
 }
 const run=await apply(rows.map(JSON.stringify).join('\n'))
 const reply=await receive({messageId:'ambiguous-key'})
 assert.equal(reply.data.state,'suspended',fixture.vendor+' shared legacy key requires review')
 assert.equal(reply.data.conversationId,null,'ambiguity never selects a ticket')
 await app.ok(imports+'/'+run.id+'/undo',{token,body:{}});await app.drainJobs()
 assert.equal((await app.ok(imports+'/'+run.id,{token})).data.state,'undone')
}
