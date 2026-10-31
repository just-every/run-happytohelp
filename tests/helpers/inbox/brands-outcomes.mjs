import assert from 'node:assert/strict'
import {brandMailboxOutcomes} from './brands-mailbox-outcomes.mjs'

// Refusals explain the authority/selection problem without pinning UI wording.
function explained(result,status,meaning){
 assert.equal(result.status,status)
 assert.equal(typeof result.data.error,'string')
 assert.match(result.data.error,meaning)
 assert.doesNotMatch(result.data.error,/\bSELECT\b[\s\S]*\bFROM\b|stack|binding|Error:/i)
 assert.equal(result.data.data,undefined,'refusal returns no partial brand data')
}

export async function brandsOutcomes({app,alpha,records,owner,shared,selection,reports,sent}){
 const [a,b]=records,admin=alpha.tokens.admin
 const manifest=(await app.ok(selection,{token:owner})).data
 assert.deepEqual(manifest.brands.map(row=>row.id),records.map(row=>row.projectId))
 assert.deepEqual(manifest.brands.map(row=>row.origin),records.map(row=>row.origin))
 assert.deepEqual(manifest.brands.map(row=>row.helpCenterPath),records.map(row=>`/help/${row.projectId}`))
 for(const r of records){
  const settings=(await app.ok(`/api/management/projects/${r.projectId}/settings`,{token:r.brandOwner})).data
  assert.equal(new URL(settings.website).origin,r.origin)
  const email=(await app.ok(`/api/management/projects/${r.projectId}/email-settings`,{token:r.brandOwner})).data
  assert.equal(email.from_address,r.box.address)
  assert.equal(email.inbound_address,`gateway@${r.label.toLowerCase()}.example.test`)
  assert.equal(manifest.brands.find(row=>row.id===r.projectId).mailboxes.find(row=>row.id===r.box.id).address,r.box.address)
  // A widget reply explicitly selects the brand's connected support mailbox.
  const before=await app.ok(`/api/conversations/${r.widget.id}/messages`,{token:r.brandOperator})
  r.widgetAnswer=r.label+' selected-mailbox widget answer'
  const answer=await app.ok(`/api/conversations/${r.widget.id}/messages`,{token:r.brandOperator,body:{localId:'brand-widget-mailbox-answer',content:r.widgetAnswer,mailboxId:r.box.id,expectedRevision:before.revision,expectedLastMessageId:before.lastMessageId}})
  assert.equal(answer.accepted,true)
  await app.ok(`/api/dashboard/projects/${r.projectId}/conversations/${r.widget.id}`,{token:r.brandOperator,method:'PUT',body:{resolved:true}})
 }
 await app.drainJobs()
 await app.until(()=>records.every(r=>sent.some(mail=>mail.text?.includes(r.widgetAnswer))),{message:'each widget answer has its selected branded sent copy'})
 const expected=[]
 for(const [own,foreign] of [[a,b],[b,a]]){
  const desk=`/api/dashboard/projects/${own.projectId}`
  const inbox=(await app.ok(desk+'/conversations?view=all',{token:own.brandOperator})).data
  assert.deepEqual(inbox.map(row=>row.id).sort(),[own.widget.id,own.emailId].sort(),'each intake opens exactly one ticket only in its brand')
  let resolved=0
  for(const id of [own.widget.id,own.emailId]){
   const conversation=await app.ok(`/api/conversations/${id}`,{token:own.brandOperator})
   assert.equal(conversation.project_id,own.projectId)
   assert.ok(conversation.resolved_at,'both the widget and email ticket are resolved')
   resolved++
   assert.equal((await app.call(`/api/dashboard/projects/${foreign.projectId}/conversations/${id}`,{token:foreign.brandOwner})).status,404)
  }
  for(const text of [own.widgetAnswer,own.label+' request resolved']){
   const copies=sent.filter(mail=>mail.text?.includes(text)&&(text===own.widgetAnswer||mail.subject.includes(own.label+' support')))
   assert.ok(copies.length>0)
   for(const copy of copies){
    assert.ok(copy.from.includes(own.box.address))
    assert.ok(!copy.from.includes(foreign.box.address))
    assert.ok(copy.text.includes(own.label+' care team'))
    assert.ok(!copy.text.includes(foreign.label+' care team'))
   }
  }
  const report=await app.ok(desk+'/reports?period=7',{token:own.brandOperator})
  assert.equal(report.volume,inbox.length)
  assert.equal(report.aiResolution.total,resolved)
  expected.push({id:own.projectId,volume:inbox.length,resolved})
  const ticket=(await app.ok(desk+`/conversations/${own.widget.id}/ticket`,{token:own.brandOwner})).data
  const move=await app.call(desk+`/conversations/${own.widget.id}/ticket`,{token:own.brandOwner,method:'PATCH',body:{expected_version:ticket.ticket_version,brand_id:foreign.projectId}})
  explained(move,400,/brand|workspace/i)
  assert.equal((await app.ok(desk+`/conversations/${own.widget.id}/ticket`,{token:own.brandOwner})).data.brand_id,own.projectId)
 }
 const combined=(await app.ok(reports,{token:shared})).data
 assert.deepEqual(combined.brands.map(row=>({id:row.id,volume:row.volume,resolved:row.aiResolution.total})),expected)
 assert.equal(combined.aggregate.volume,expected.reduce((sum,row)=>sum+row.volume,0))
 assert.equal(combined.aggregate.resolved,expected.reduce((sum,row)=>sum+row.resolved,0))
 assert.equal((await app.ok(selection,{token:owner})).data.brands[0].policy.collectEmail,false)
 assert.equal((await app.ok(`/api/management/projects/${b.projectId}/settings`,{token:b.brandOwner})).data.collect_email,true)
 // An Alpha admin has no Beta authority until explicitly invited and accepted.
 const betaDesk=`/api/dashboard/projects/${b.projectId}`
 explained(await app.call(selection,{token:admin}),403,/membership|invite|access/i)
 explained(await app.call(reports,{token:admin}),403,/membership|permission|access/i)
 explained(await app.call(`/api/management/projects/${b.projectId}/settings`,{token:admin,method:'PUT',body:{collect_email:false}}),403,/access|project/i)
 explained(await app.call(betaDesk+'/reports?period=7',{token:admin}),403,/access|project/i)
 assert.equal((await app.call(betaDesk+'/conversations',{token:admin})).status,403)
 assert.equal((await app.call(`/api/conversations/${b.widget.id}/messages`,{token:admin})).status,404)
 const visible=async()=>new Set((await app.ok('/api/dashboard/conversations?view=all',{token:admin})).data.map(row=>row.id))
 assert.ok((await visible()).has(a.widget.id))
 assert.ok(!(await visible()).has(b.widget.id))
 for(const path of [selection.split('?')[0],reports.split('?')[0]]){
  for(const ids of [a.projectId,a.projectId+','+a.projectId,a.projectId+',bad%2Fbrand'])explained(await app.call(path+'?projects='+ids,{token:owner}),400,/select|brand/i)
  explained(await app.call(path+'?projects='+a.projectId+',unavailable',{token:owner}),403,/membership|permission|access/i)
 }
 await brandKnowledgeOutcomes(app,records,sent)
 const inviteAdmin=async()=>{
  const invite=(await app.ok(`/api/management/projects/${b.projectId}/agents`,{token:b.brandOwner,body:{email:'admin-brand-alpha@example.test',role:'admin'}})).data
  // Selection before acceptance cannot grant the pending teammate access.
  assert.equal((await app.call(selection,{token:admin})).status,403)
  await app.ok('/api/identity/accept-invitation',{token:admin,body:{token:new URL(invite.invitationUrl).searchParams.get('token')}})
 }
 await inviteAdmin()
 assert.equal((await app.call(selection,{token:admin})).status,200)
 assert.equal((await app.call(reports,{token:admin})).status,200)
 assert.ok((await visible()).has(b.widget.id))
 // Race a genuine membership revocation with the report's database read, not a fake permission result.
 const revoke=`DELETE FROM memberships WHERE project_id='${b.projectId}' AND user_id='${alpha.users.admin}'`
 explained(await app.call(reports,{token:admin,headers:{'x-test-statement':'WITH cohort AS','x-test-before-statement':revoke}}),403,/membership|permission|access/i)
 await inviteAdmin()
 await app.ok(`/api/management/projects/${b.projectId}/agents/${alpha.users.admin}`,{token:b.brandOwner,method:'DELETE'})
 explained(await app.call(selection,{token:admin}),403,/membership|access/i)
 explained(await app.call(reports,{token:admin}),403,/membership|permission|access/i)
 assert.equal((await app.call(betaDesk+'/reports?period=7',{token:admin})).status,403)
 assert.equal((await app.call(betaDesk+'/conversations',{token:admin})).status,403)
 assert.equal((await app.call(betaDesk+`/conversations/${b.widget.id}`,{token:admin})).status,404)
 assert.equal((await app.call(`/api/conversations/${b.widget.id}/messages`,{token:admin})).status,404)
 assert.ok(!(await visible()).has(b.widget.id))
 assert.ok((await visible()).has(a.widget.id))
 assert.equal((await app.call(`/api/dashboard/projects/${a.projectId}/reports?period=7`,{token:admin})).status,200)
 await brandMailboxOutcomes()
}

async function brandKnowledgeOutcomes(app,records,sent){
 for(const own of records){
  own.restrictedSlug=own.label.toLowerCase()+'-private-guide'
  const category=await app.ok(`/api/knowledge/${own.projectId}/categories`,{token:own.brandOwner,body:{name:own.label+' signed-in collection',audience:'signed-in'}})
  await app.ok(`/api/knowledge/${own.projectId}/articles`,{token:own.brandOwner,body:{title:own.label+' private guide',slug:own.restrictedSlug,content:own.label+' restricted guide content',is_published:true,categoryId:category.id}})
  const prior=sent.length
  await app.ok(`/api/knowledge/public/${own.projectId}/access/request`,{body:{email:'maya@customer.example.test'}})
  const mail=sent.slice(prior).find(copy=>copy.text?.includes('/access/verify?token='))
  assert.ok(mail,'access is earned through the brand help-center sign-in mail')
  const link=new URL(mail.text.match(/https:\/\/[^\s]+/)[0])
  const verified=await app.call(link.pathname+link.search)
  assert.equal(verified.status,303)
  own.helpCookie=verified.headers.get('Set-Cookie').split(';')[0]
  own.publicSlug=own.label.toLowerCase()+'-public-guide'
  await app.ok(`/api/knowledge/${own.projectId}/articles`,{token:own.brandOwner,body:{title:own.label+' public guide',slug:own.publicSlug,content:own.label+' public guide content',is_published:true}})
 }
 for(const [own,foreign] of [[records[0],records[1]],[records[1],records[0]]]){
  const publicDoor=`/api/knowledge/public/${own.projectId}/articles`
  assert.equal((await app.call(publicDoor+'/'+own.restrictedSlug,{headers:{Cookie:own.helpCookie}})).status,200,'own help session admits own private article')
  assert.equal((await app.call(publicDoor+'/'+own.restrictedSlug,{headers:{Cookie:foreign.helpCookie}})).status,404,'another brand’s help session grants no private knowledge')
  assert.equal((await app.call(publicDoor+'/'+foreign.restrictedSlug,{headers:{Cookie:own.helpCookie}})).status,404)

  const articles=await app.ok(publicDoor,{token:own.visitor.token})
  assert.deepEqual(articles.map(row=>row.slug),[own.publicSlug])
  assert.equal((await app.call(publicDoor+'/'+foreign.publicSlug,{token:own.visitor.token})).status,404)
  assert.ok(!JSON.stringify(articles).includes(foreign.label+' private-only content'))
  const ownPrivate=(await app.ok(`/api/knowledge/${own.projectId}/articles`,{token:own.brandOwner})).find(row=>row.id===own.draft.id)
  const foreignPrivate=(await app.ok(`/api/knowledge/${foreign.projectId}/articles`,{token:foreign.brandOwner})).find(row=>row.id===foreign.draft.id)
  for(const slug of [ownPrivate.slug,foreignPrivate.slug])assert.equal((await app.call(publicDoor+'/'+slug,{token:own.visitor.token})).status,404)
  assert.equal((await app.call(`/api/knowledge/${own.projectId}/articles`,{token:own.brandOwner,body:{id:foreign.draft.id,title:'Wrong brand edit',content:'Must not replace private knowledge'}})).status,404)
  assert.equal((await app.ok(`/api/knowledge/${foreign.projectId}/articles`,{token:foreign.brandOwner})).find(row=>row.id===foreign.draft.id).content,foreignPrivate.content)
 }
}
