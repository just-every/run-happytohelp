import assert from 'node:assert/strict'

// Finish the same customer's support lifecycle; erasure never starts a second
// tenant or runtime and checks the transcript that the operator just resolved.
export async function eraseCustomer({page,widget,key,runtime,owner,api,audit}) {
 const session=await widget.evaluate(key=>JSON.parse(localStorage.getItem(key)),key)
 const {conversationId,contactId}=session,projectId=owner.projectId
 const path=`/api/management/projects/${projectId}/contacts/${contactId}`
 const before=await api(`/api/conversations/${conversationId}/messages`,{token:owner.token})
 const uploaded=before.messages.flatMap(message=>message.media).find(media=>media.id)
 assert.ok(uploaded,'the customer attachment sent through the widget is in the native transcript')
 // A separate visitor is the control for the erasure's workspace scope.
 const project=await api('/api/identity/projects/'+projectId,{token:owner.token})
 const retained=await fetch(runtime.origin+'/api/identity/widget/session',{method:'POST',headers:{Origin:new URL(widget.url()).origin,'Content-Type':'application/json'},body:JSON.stringify({widgetKey:project.widget_key,name:'Retained customer'})})
 assert.ok(retained.ok);const kept=await retained.json()
 await page.goto(`${runtime.origin}/projects/${projectId}/contacts/${contactId}`)
 const start=page.getByRole('button',{name:'Erase personal data…',exact:true});await start.click()
 const confirm=page.getByRole('button',{name:'Permanently erase',exact:true}),typed=page.getByLabel('Type ERASE to confirm')
 assert.ok(await confirm.isDisabled());await typed.fill('erase');assert.ok(await confirm.isDisabled())
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await start.waitFor()
 assert.equal((await api(`/api/conversations/${conversationId}/messages`,{token:owner.token})).revision,before.revision)
 await start.click();await typed.fill('ERASE');await audit(page,'erasure-confirmation')
 const erased=page.waitForResponse(response=>new URL(response.url()).pathname===path+'/erase')
 await confirm.click();assert.equal((await erased).status(),200);await page.getByText('Personal data erased.',{exact:false}).waitFor()
 const record=(await api(path,{token:owner.token})).data
 assert.deepEqual([record.name,record.email,JSON.parse(record.metadata_json).is_erased],[null,null,1])
 const after=await api(`/api/conversations/${conversationId}/messages`,{token:owner.token})
 assert.equal(after.revision,before.revision);assert.deepEqual(after.messages.map(m=>m.id),before.messages.map(m=>m.id))
 assert.ok(after.messages.every(message=>message.content===''&&message.erased_at&&message.media.length===0))
 assert.equal((await fetch(`${runtime.origin}/api/conversations/${conversationId}/media/${uploaded.id}`,{headers:{Authorization:'Bearer '+owner.token}})).status,404)
 assert.equal((await fetch(`${runtime.origin}/api/conversations/${conversationId}/messages`,{headers:{Authorization:'Bearer '+session.token}})).status,401)
 assert.equal((await fetch(runtime.origin+'/api/identity/widget/profile',{headers:{Authorization:'Bearer '+kept.token}})).status,200)
 await page.goto(`${runtime.origin}/projects/${projectId}/conversations/${conversationId}`)
 await page.getByText('Message erased',{exact:true}).first().waitFor()
 assert.equal(await page.getByText('Here is the answer for your report',{exact:true}).count(),0)
 await audit(page,'erased-transcript')
}
