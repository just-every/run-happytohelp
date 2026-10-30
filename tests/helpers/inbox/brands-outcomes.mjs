import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

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

// Two independent accounts issue different credentials at the provider HTTP edge.
// The application performs OAuth, encryption, selection and polling unchanged.
export async function brandCredentialOutcomes(){
 const accounts=['alpha','beta'].map(label=>({label,address:`care@${label}.example.test`,accessToken:`synthetic-${label}-access`,refreshToken:`synthetic-${label}-refresh`}))
 let expectedAccount
 const polls=[]
 const app=await startApp({bindings:{APP_ORIGIN:'https://app.example',H2H_SETUP_TOKEN:'synthetic-brand-setup',INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,19).toString('base64'),GOOGLE_MAIL_CLIENT_ID:'synthetic-brand-client',GOOGLE_MAIL_CLIENT_SECRET:'synthetic-brand-secret'},outbound:async request=>{
  const url=new URL(request.url)
  if(url.hostname==='oauth2.googleapis.com'&&url.pathname==='/token'){
   const body=new URLSearchParams(await request.text()),account=accounts.find(row=>row.label===body.get('code'))
   assert.ok(account);assert.ok(body.get('code_verifier'))
   return Response.json({access_token:account.accessToken,refresh_token:account.refreshToken,expires_in:3600,token_type:'Bearer'})
  }
  assert.equal(url.hostname,'gmail.googleapis.com')
  const account=accounts.find(row=>request.headers.get('authorization')==='Bearer '+row.accessToken)
  assert.ok(account);assert.equal(account,expectedAccount,'only the selected brand credential reaches its provider')
  polls.push(account.label)
  if(url.pathname.endsWith('/profile'))return Response.json({emailAddress:account.address,historyId:'1'})
  if(url.pathname.endsWith('/settings/sendAs'))return Response.json({sendAs:[{sendAsEmail:account.address,verificationStatus:'accepted'}]})
  if(url.pathname.endsWith('/messages'))return Response.json({messages:[]})
  throw new Error('Unexpected provider operation '+url.pathname)
 }})
 try{
  const email='brand-owner@example.test',password='synthetic-brand-owner-password'
  const first=await app.ok('/api/identity/bootstrap',{body:{email,password,name:'Credential Alpha',allowedOrigin:'https://alpha.example.test',setupToken:'synthetic-brand-setup'}})
  const owner=(await app.ok('/api/identity/login',{body:{email,password}})).token
  const second=await app.ok('/api/management/projects',{token:owner,body:{name:'Credential Beta',allowed_origin:'https://beta.example.test'}})
  const records=[]
  for(const [i,projectId] of [first.projectId,second.id].entries()){
   const token=(await app.ok('/api/identity/switch-project',{token:owner,body:{projectId}})).token
   const base=`/api/management/projects/${projectId}/mailboxes`,account=accounts[i]
   expectedAccount=account
   const started=await app.ok(base+'/connect',{token,body:{provider:'gmail'}}),state=new URL(started.url).searchParams.get('state')
   assert.equal((await app.call(`/api/management/mailboxes/oauth/gmail/callback?state=${state}&code=${account.label}`,{token})).status,302)
   const listing=await app.ok(base,{token}),box=listing.data.find(row=>row.address===account.address)
   assert.ok(box);assert.equal(box.status,'connected')
   records.push({projectId,token,base,box,account})
  }
  const selected=records.map(row=>row.projectId).join(',')
  const manifest=(await app.ok(`/api/management/projects/${first.projectId}/brands?projects=${selected}`,{token:owner})).data
  for(const own of records){
   const foreign=records.find(row=>row!==own),listing=await app.ok(own.base,{token:own.token})
   assert.deepEqual(listing.data.map(row=>row.id),[own.box.id])
   assert.deepEqual(manifest.brands.find(row=>row.id===own.projectId).mailboxes.map(row=>row.id),[own.box.id])
   const publicData=JSON.stringify({listing,manifest})
   for(const account of accounts)for(const value of [account.accessToken,account.refreshToken])assert.ok(!publicData.includes(value),'mailbox and brand views never expose either account credential')
   const before=polls.length
   for(const [suffix,method,body] of [['/poll','POST',{}],['/reconnect','POST',{}],['','PATCH',{senderAddress:foreign.account.address}]]){
    const refused=await app.call(own.base+`/${foreign.box.id}`+suffix,{token:own.token,method,body})
    assert.equal(refused.status,404);assert.match(refused.data.error,/mailbox|not found/i)
   }
   assert.equal(polls.length,before,'foreign mailbox actions never use a provider credential')
   expectedAccount=own.account
   assert.equal((await app.ok(own.base+`/${own.box.id}/poll`,{token:own.token,body:{}})).received,0)
   assert.ok(polls.length>before)
  }
 }finally{await app.close()}
}
