import assert from 'node:assert/strict'
import {brandCredentialOutcomes} from './brands-credentials.mjs'

// Check readable reasons by meaning, without pinning the product's wording.
function refusal(response,status,meaning){
 assert.equal(response.status,status)
 assert.equal(typeof response.data.error,'string')
 assert.match(response.data.error,meaning)
 assert.doesNotMatch(response.data.error,/stack|SELECT|binding|TypeError/)
}

export async function brandsOutcomes({app,alpha,owner,shared,records,selection,reports}){
 const [a,b]=records,management=id=>`/api/management/projects/${id}`
 // Combined doors need a deliberate multi-brand selection, including the active brand.
 for(const door of [selection,reports])for(const ids of ['',a.projectId,`${a.projectId},bad!`,`${a.projectId},unavailable`]){
  const url=new URL(door,app.origin);url.searchParams.set('projects',ids)
  refusal(await app.call(url.pathname+url.search,{token:owner}),ids.endsWith('unavailable')?403:400,/brand|select|membership/i)
 }
 refusal(await app.call(selection,{token:shared}),403,/owner|admin/i)
 const explanation=(await app.ok(selection,{token:owner})).data.explanation
 assert.match(explanation,/invit|access|authoriz/i)
 assert.match(explanation,/handoff|destination/i)

 const manifest=(await app.ok(selection,{token:owner})).data
 assert.deepEqual(manifest.brands.map(row=>row.origin),[a.origin,b.origin])
 for(const brand of records)await app.ok(`/api/knowledge/${brand.projectId}/articles`,{token:brand.brandOwner,body:{title:brand.label+' public guide',slug:'brand-guide',content:brand.label+' public-only content',is_published:true}})
 const expected=[]
 for(const [own,foreign] of [[a,b],[b,a]]){
  const desk=`/api/dashboard/projects/${own.projectId}/conversations`
  const inbox=(await app.ok(desk+'?view=all',{token:own.brandOwner})).data
  assert.deepEqual(inbox.map(row=>row.id).sort(),[own.widget.id,own.emailId].sort(),'one widget and one email ticket, only in their receiving brand')
  assert.ok(inbox.every(row=>row.brand_id===own.projectId))
  const resolved=[]
  for(const id of [own.widget.id,own.emailId]){
   const ticket=await app.ok(`/api/conversations/${id}`,{token:own.brandOperator})
   assert.equal(ticket.project_id,own.projectId);assert.ok(ticket.resolved_at)
   resolved.push(id)
  }
  const transcript=await app.ok(`/api/conversations/${own.widget.id}/messages`,{token:own.visitor.token})
  assert.ok(transcript.messages.some(row=>row.content===own.label+' request resolved'))
  assert.ok(!JSON.stringify(transcript).includes(foreign.label+' request resolved'))
  expected.push({id:own.projectId,volume:inbox.length,resolved:resolved.length})
  const visitorList=await app.ok('/api/conversations',{token:own.visitor.token})
  assert.ok(visitorList.conversations.some(row=>row.id===own.widget.id))
  assert.ok(visitorList.conversations.every(row=>![foreign.widget.id,foreign.emailId].includes(row.id)))
  const ticket=(await app.ok(desk+`/${own.widget.id}/ticket`,{token:own.brandOwner})).data
  refusal(await app.call(desk+`/${own.widget.id}/ticket`,{token:own.brandOwner,method:'PATCH',body:{expected_version:ticket.ticket_version,brand_id:foreign.projectId}}),400,/brand|workspace/i)
  // Editing by a foreign article ID must leave the source article intact.
  refusal(await app.call(`/api/knowledge/${own.projectId}/articles`,{token:own.brandOwner,body:{id:foreign.draft.id,title:'Foreign edit',content:'This must never replace the original'}}),404,/not found/i)
  const source=await app.ok(`/api/knowledge/${foreign.projectId}/articles`,{token:foreign.brandOwner})
  assert.equal(source.find(row=>row.id===foreign.draft.id).content,foreign.label+' private-only content')
  const privateSlug=source.find(row=>row.id===foreign.draft.id).slug
  for(const projectId of [own.projectId,foreign.projectId])assert.equal((await app.call(`/api/knowledge/public/${projectId}/articles/${privateSlug}`,{token:own.visitor.token})).status,404)
  const publicArticle=await app.ok(`/api/knowledge/public/${own.projectId}/articles/brand-guide`,{token:own.visitor.token})
  assert.equal(publicArticle.content,own.label+' public-only content')
  const publicList=await app.ok(`/api/knowledge/public/${own.projectId}/articles`,{token:own.visitor.token})
  assert.deepEqual(publicList.map(row=>row.content),[own.label+' public-only content'])
  const boxes=(await app.ok(management(own.projectId)+'/mailboxes',{token:own.brandOwner})).data
  assert.ok(boxes.some(row=>row.id===own.box.id));assert.ok(!boxes.some(row=>row.id===foreign.box.id))
  assert.deepEqual(boxes.find(row=>row.id===own.box.id).signatures.map(row=>row.text),[own.label+' care team'])
  refusal(await app.call(management(own.projectId)+`/mailboxes/${foreign.box.id}/signatures/default`,{token:own.brandOwner,method:'PUT',body:{text:'Foreign signature'}}),404,/mailbox|not found/i)
 }
 const report=(await app.ok(reports,{token:shared})).data
 assert.deepEqual(report.brands.map(row=>({id:row.id,volume:row.volume,resolved:row.aiResolution.total})),expected)
 assert.equal(report.aggregate.volume,expected.reduce((sum,row)=>sum+row.volume,0))
 assert.equal(report.aggregate.resolved,expected.reduce((sum,row)=>sum+row.resolved,0))

 // An existing Alpha administrator gets no Beta access merely by selecting it.
 const admin=alpha.tokens.admin
 refusal(await app.call(selection,{token:admin}),403,/membership|invit/i)
 refusal(await app.call(reports,{token:admin}),403,/membership|permission/i)
 refusal(await app.call(management(b.projectId)+'/settings',{token:admin,method:'PUT',body:{collect_email:false}}),403,/access|project/i)
 refusal(await app.call(`/api/dashboard/projects/${b.projectId}/conversations`,{token:admin}),403,/access|project/i)
 assert.equal((await app.call(`/api/conversations/${b.widget.id}/messages`,{token:admin})).status,404)
 const invite=(await app.ok(management(b.projectId)+'/agents',{token:b.brandOwner,body:{email:'admin-brand-alpha@example.test',role:'admin'}})).data
 await app.ok('/api/identity/accept-invitation',{token:admin,body:{token:new URL(invite.invitationUrl).searchParams.get('token')}})
 assert.equal((await app.call(selection,{token:admin})).status,200)
 assert.equal((await app.call(reports,{token:admin})).status,200)
 // A real membership deletion during a report read, using the existing D1
 // scheduling hook: no report rows or authority results are substituted.
 const raced=await app.call(reports,{token:admin,headers:{'x-test-statement':'WITH cohort AS','x-test-before-statement':`DELETE FROM memberships WHERE project_id='${b.projectId}' AND user_id='${alpha.users.admin}'`}})
 refusal(raced,403,/membership|permission/i)
 assert.ok(!('data' in raced.data),'the raced aggregate returns no removed-brand figures')
 refusal(await app.call(selection,{token:admin}),403,/membership|invit/i)
 refusal(await app.call(reports,{token:admin}),403,/membership|permission/i)
 refusal(await app.call(`/api/dashboard/projects/${b.projectId}/conversations`,{token:admin}),403,/access|project/i)
 assert.equal((await app.call(`/api/conversations/${b.widget.id}/messages`,{token:admin})).status,404)
 const global=(await app.ok('/api/dashboard/conversations?view=all',{token:admin})).data
 assert.deepEqual(global.map(row=>row.id).sort(),[a.widget.id,a.emailId].sort())
 assert.equal((await app.call(`/api/conversations/${a.widget.id}/messages`,{token:admin})).status,200)
 assert.equal((await app.call(`/api/dashboard/projects/${a.projectId}/reports?period=7`,{token:admin})).status,200)
 await brandCredentialOutcomes()
}
