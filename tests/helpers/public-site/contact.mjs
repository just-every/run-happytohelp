import assert from 'node:assert/strict'

/** The published native contact door writes to the bound inbox without granting mailbox access. */
export async function publicContactProof(runtime,request,tenant,other){
 assert.equal((await request('/contact')).status,503,'an unbound installation never guesses a tenant')
 await runtime.execute(`UPDATE owner_setup SET claim_id='${tenant.userId}' WHERE singleton=1; INSERT INTO h2h_business_project VALUES(1,'${tenant.projectId}','${tenant.userId}')`)
 try{
  const setup=await request(`/api/management/projects/${tenant.projectId}/activation/check`,{token:tenant.token,body:{step:'widget_origin'}})
  assert.equal(setup.status,200,await setup.clone().text())
  const contact=await request('/contact');assert.equal(contact.status,303)
  assert.equal(contact.headers.get('location'),`/help/${tenant.projectId}/requests#launch-chat`)
  const forms=await (await request(`/api/forms/${tenant.projectId}`)).json();assert.equal(forms.data.length,1)
  const definition=forms.data[0],published=await request(`/help/${tenant.projectId}/requests/${definition.id}`)
  assert.equal(published.status,200)
  const formHtml=await published.text();assert.match(formHtml,/<form id="customer-request"/)
  const settings=await (await request(`/api/management/projects/${tenant.projectId}/widget-settings`,{token:tenant.token})).json()
  for(const path of ['/', '/docs', '/run', '/contract', `/help/${tenant.projectId}`, `/help/${tenant.projectId}/requests`]){
   const response=await request(path);assert.equal(response.status,200,path)
   const html=await response.text();assert.ok(html.includes(`data-widget-key="${settings.widgetKey}"`),path+' publishes its own widget')
   assert.match(html,/data-config="[^\"]*requireEmail/)
   for(const href of [...html.matchAll(/href="(\/run|\/contract|\/docs(?:\/getting-started)?)"/g)].map(match=>match[1]))assert.equal((await request(href)).status,200,'native public navigation '+href)
  }
  assert.doesNotMatch(await (await request(`/help/${other.projectId}`)).text(),/data-widget-key=/,'another tenant never inherits the installation inbox')
  const session=await (await request('/api/identity/widget/session',{headers:{Origin:runtime.origin},body:{widgetKey:settings.widgetKey,email:'typed-public@example.test'}})).json()
  assert.equal(session.verified,false)
  const conversation=await (await request('/api/conversations',{token:session.token,body:{projectId:tenant.projectId}})).json()
  const sent=await request(`/api/conversations/${conversation.id}/messages`,{token:session.token,body:{localId:'public-contact-message',content:'Please help me with this installation.',expectedRevision:0}})
  assert.ok(sent.ok,await sent.clone().text())
  assert.equal((await request(`/api/portal/${tenant.projectId}/tickets`,{token:session.token})).status,401,'typed email has no portal authority')
  const inbox=await (await request(`/api/dashboard/projects/${tenant.projectId}/conversations`,{token:tenant.token})).json()
  assert.ok(JSON.stringify(inbox).includes(conversation.id),'the native owner inbox receives the visitor request')
  // Rechecking Setup must not republish a form the owner deliberately disabled.
  const stored=(await (await request(`/api/forms/projects/${tenant.projectId}/forms`,{token:tenant.token})).json()).data[0]
  const disabled=await request(`/api/forms/projects/${tenant.projectId}/forms/${definition.id}`,{method:'PATCH',token:tenant.token,body:{updatedAt:stored.updatedAt,enabled:false}});assert.ok(disabled.ok,await disabled.clone().text())
  assert.equal((await request(`/api/management/projects/${tenant.projectId}/activation/check`,{token:tenant.token,body:{step:'widget_origin'}})).status,200)
  assert.equal((await (await request(`/api/forms/${tenant.projectId}`)).json()).data.length,0)
 }finally{
  await runtime.execute("DELETE FROM h2h_business_project; UPDATE owner_setup SET claim_id='existing-installation' WHERE singleton=1")
 }
}
