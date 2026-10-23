import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

export async function brandsJourney(){
 const sent=[]
 const app=await startApp({captureQueue:true,bindings:{APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-happytohelp-1',EMAIL_FROM:'support@installation.example.test',INBOUND_EMAIL_TOKEN:'synthetic-happytohelp-2'},outbound:async request=>{
  if(new URL(request.url).hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.test.'}]})
  assert.equal(new URL(request.url).hostname,'api.resend.com');sent.push(await request.json());return Response.json({id:'synthetic-happytohelp-'+sent.length})
 }})
 try{
  const alpha=await app.seedWorkspace('brand-alpha',{name:'Brand Alpha',allowedOrigin:'https://alpha.example.test'})
  const outsider=await app.seedWorkspace('brand-outsider')
  const owner=alpha.tokens.owner,shared=alpha.tokens.operator
  const beta=await app.ok('/api/management/projects',{token:owner,body:{name:'Brand Beta',allowed_origin:'https://beta.example.test'}})
  const selection=`/api/management/projects/${alpha.projectId}/brands?projects=${alpha.projectId},${beta.id}`
  const summary=(await app.ok(selection,{token:owner})).data
  assert.deepEqual(summary.sharedTeam.map(p=>p.id),[alpha.users.owner],'creation never copies staff access')
  assert.equal((await app.call(selection,{token:shared})).status,403)
  assert.equal((await app.call(selection,{token:outsider.tokens.owner})).status,403)
  const invite=(await app.ok(`/api/management/projects/${beta.id}/agents`,{token:owner,body:{email:'operator-brand-alpha@example.test'}})).data
  await app.ok('/api/identity/accept-invitation',{token:shared,body:{token:new URL(invite.invitationUrl).searchParams.get('token')}})
  const deliberate=(await app.ok(selection,{token:owner})).data
  assert.ok(deliberate.sharedTeam.some(p=>p.id===alpha.users.operator&&p.roles[beta.id]==='operator'))
  const records=[]
  for(const [projectId,label,origin] of [[alpha.projectId,'Alpha',alpha.allowedOrigin],[beta.id,'Beta','https://beta.example.test']]){
   const brandOwner=(await app.ok('/api/identity/switch-project',{token:owner,body:{projectId}})).token
   const brandOperator=(await app.ok('/api/identity/switch-project',{token:shared,body:{projectId}})).token
   const manage=`/api/management/projects/${projectId}`,desk=`/api/dashboard/projects/${projectId}`
   await app.ok(manage+'/settings',{token:brandOwner,method:'PUT',body:{website:origin,allowed_origin:origin,help_center_domain:`https://help.${label.toLowerCase()}.example.test`,timezone:'UTC',collect_email:true,is_enabled:true}})
   await app.ok(manage+'/availability',{token:brandOwner,method:'PUT',body:{is_availability_schedule_enabled:false,is_presence_away_enabled:false}})
   const address=`support@${label.toLowerCase()}.example.test`
   await app.ok(manage+'/email-settings',{token:brandOwner,method:'PUT',body:{from_name:label+' Support',from_address:address,inbound_address:`gateway@${label.toLowerCase()}.example.test`,is_enabled:true}})
   const box=(await app.ok(manage+'/mailboxes',{token:brandOwner,body:{provider:'forwarding',address,displayName:label+' Support'}})).data
   await app.ok(manage+`/mailboxes/${box.id}/signatures/default`,{token:brandOwner,method:'PUT',body:{text:label+' care team'}})
   const group=(await app.ok(desk+'/ticket-groups',{token:brandOwner,body:{name:label+' shared support',members:[alpha.users.owner,alpha.users.operator]}})).data
   await app.ok(desk+'/routing-operators',{token:brandOwner,method:'PUT',body:{operators:[{user_id:alpha.users.operator,available:true,capacity:100,skills:[]}]}})
   const {rule}=await app.ok(desk+'/workflow-rules',{token:brandOwner,body:{name:label+' brand routing',kind:'routing',position:1,conditions:{all:[]},actions:[],routing:{strategy:'named',user_id:alpha.users.operator,group_id:group.id,skills:[]}}})
   await app.ok(desk+`/workflow-rules/${rule.id}/publish`,{token:brandOwner,body:{}})
   const project=await app.ok('/api/identity/projects/'+projectId,{token:brandOwner})
   const visitor=await app.ok('/api/identity/widget/session',{body:{widgetKey:project.widget_key,name:'Same customer',email:'maya@customer.example.test'},headers:{Origin:origin}})
   assert.equal((await app.call('/api/widget/settings?widgetKey='+project.widget_key,{headers:{Origin:origin===alpha.allowedOrigin?'https://beta.example.test':alpha.allowedOrigin}})).status,403)
   const widget=await app.ok('/api/conversations',{token:visitor.token,body:{projectId}})
   await app.ok(`/api/conversations/${widget.id}/messages`,{token:visitor.token,body:{localId:'synthetic-happytohelp-widget',content:label+' widget request',expectedRevision:0}})
   const mail=await app.ok('/api/integrations/email/inbound',{token:'synthetic-happytohelp-2',body:{messageId:'synthetic-happytohelp-'+label,from:'maya@customer.example.test',to:address,text:label+' email request',subject:label+' support'}})
   await app.scheduled()
   await app.drainJobs()
   const emailId=mail.conversationId
   assert.ok(emailId)
   for(const conversationId of [widget.id,emailId]){
    const ticket=(await app.ok(desk+`/conversations/${conversationId}/ticket`,{token:brandOperator})).data
    assert.equal(ticket.assigned_to,alpha.users.operator,JSON.stringify({brand:label,conversationId,ticket,routing:await app.ok(desk+`/conversations/${conversationId}/routing`,{token:brandOperator})}));assert.equal(ticket.group_id,group.id)
    const decision=await app.ok(desk+`/conversations/${conversationId}/routing`,{token:brandOperator});assert.match(decision.decision.explanation,new RegExp(label+' brand routing'))
    const before=await app.ok(`/api/conversations/${conversationId}/messages`,{token:brandOperator})
    await app.ok(`/api/conversations/${conversationId}/messages`,{token:brandOperator,body:{localId:'synthetic-happytohelp-reply',content:label+' request resolved',expectedRevision:before.revision,expectedLastMessageId:before.lastMessageId}})
    await app.ok(desk+`/conversations/${conversationId}`,{token:brandOperator,method:'PUT',body:{resolved:true}})
   }
   const draft=await app.ok(`/api/knowledge/${projectId}/articles`,{token:brandOwner,body:{title:label+' private instructions',content:label+' private-only content',is_published:false}})
   records.push({projectId,label,origin,visitor,widget,emailId,box,draft,brandOwner,brandOperator})
  }
  await app.until(()=>sent.some(m=>m.text?.includes('Alpha request resolved'))&&sent.some(m=>m.text?.includes('Beta request resolved')),{message:'both brands send their email answers'})
  for(const r of records){
   const receipt=sent.find(m=>m.text?.includes(r.label+' request resolved')&&m.subject.includes(r.label+' support'))
   assert.ok(receipt,'the email request receives its own branded answer')
   assert.match(receipt.from,new RegExp(r.label+' Support.*support@'+r.label.toLowerCase()+'.example.test'))
   assert.match(receipt.text,new RegExp(r.label+' care team'))
   assert.doesNotMatch(receipt.text,new RegExp((r.label==='Alpha'?'Beta':'Alpha')+' care team'))
   assert.equal((await app.ok(`/api/conversations/${r.emailId}`,{token:r.brandOperator})).resolved_at!==null,true)
  }
  const [a,b]=records
  assert.notEqual(a.visitor.contactId,b.visitor.contactId,'same email is a separate brand identity')
  for(const [own,foreign] of [[a,b],[b,a]]){
   assert.equal((await app.call(`/api/conversations/${foreign.widget.id}/messages`,{token:own.visitor.token})).status,404)
   const ownTicket=(await app.ok(`/api/dashboard/projects/${own.projectId}/conversations/${own.widget.id}/ticket`,{token:own.brandOwner})).data
   const moved=await app.call(`/api/dashboard/projects/${own.projectId}/conversations/${own.widget.id}/ticket`,{token:own.brandOwner,method:'PATCH',body:{expected_version:ownTicket.ticket_version,brand_id:foreign.projectId}})
   assert.equal(moved.status,400)
   const privateArticles=await app.ok(`/api/knowledge/${own.projectId}/articles`,{token:own.brandOwner})
   assert.ok(privateArticles.some(article=>article.id===own.draft.id))
   assert.ok(!privateArticles.some(article=>article.id===foreign.draft.id))
   assert.equal((await app.call(`/api/knowledge/public/${own.projectId}/articles`,{token:own.visitor.token})).data.length,0)
   assert.equal((await app.call(`/api/management/projects/${own.projectId}/mailboxes/${foreign.box.id}`,{token:own.brandOwner,method:'PATCH',body:{senderAddress:foreign.box.address}})).status,404)
  }
  await app.ok(`/api/management/projects/${a.projectId}/settings`,{token:owner,method:'PUT',body:{collect_email:false}})
  assert.equal((await app.ok(`/api/management/projects/${b.projectId}/settings`,{token:owner})).data.collect_email,true)
  const manifest=(await app.ok(selection,{token:owner})).data
  assert.deepEqual(manifest.brands.map(r=>r.policy.collectEmail),[false,true]);assert.notEqual(manifest.brands[0].widgetKey,manifest.brands[1].widgetKey)
  assert.deepEqual(manifest.brands.map(r=>r.helpCenterContextUrl),['https://help.alpha.example.test/','https://help.beta.example.test/'])
  assert.ok(!JSON.stringify(manifest).includes('synthetic-happytohelp-1'),'configuration never projects installation credentials')
  const reports=`/api/management/projects/${a.projectId}/brands/reports?projects=${a.projectId},${b.projectId}&period=7`
  const report=(await app.ok(reports,{token:shared})).data
  assert.deepEqual(report.brands.map(r=>r.volume),[2,2]);assert.equal(report.aggregate.volume,4);assert.equal(report.aggregate.resolved,4)
  assert.ok(report.brands.every(r=>!('comments' in r)));assert.equal(report.aggregate.satisfactionRate,null)
  // Membership is per brand, including global inbox reads and aggregate reports.
  await app.ok(`/api/management/projects/${b.projectId}/agents/${alpha.users.operator}`,{token:b.brandOwner,method:'DELETE'})
  assert.equal((await app.call(reports,{token:shared})).status,403)
  assert.equal((await app.call(`/api/dashboard/projects/${b.projectId}/conversations/${b.widget.id}`,{token:shared})).status,404)
  assert.equal((await app.call(`/api/conversations/${a.widget.id}/messages`,{token:shared})).status,200)
  assert.ok(!(await app.ok(selection,{token:owner})).data.sharedTeam.some(p=>p.id===alpha.users.operator))
  const raced=await app.call(selection,{token:owner,headers:{'x-test-statement':'SELECT id,provider,address','x-test-before-statement':`DELETE FROM memberships WHERE project_id='${b.projectId}' AND user_id='${alpha.users.owner}'`}})
  assert.equal(raced.status,403,'a brand removed during the combined read is never returned')
  for(const ids of ['',a.projectId+',unavailable',b.projectId])assert.ok((await app.call(selection.split('?')[0]+'?projects='+ids,{token:owner})).status>=400)
 }finally{await app.close()}
}
