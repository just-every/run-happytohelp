import assert from 'node:assert/strict'

// Extend the existing portal journey through its real email-link and ticket doors.
export async function companyPortalJourney(f){
 const {app,p,owner,signin,form,api,valid}=f,base=`/api/management/projects/${p}`,P=`/api/portal/${p}`
 const people=await Promise.all(['alex','bea','chen'].map(name=>signin(`${name}@northstar.example`)))
 const contacts=await Promise.all(['alex','bea','chen'].map(name=>app.first('SELECT contact_id FROM portal_identities WHERE project_id=? AND email=?',p,`${name}@northstar.example`)))
 const company=(await app.ok(base+'/companies',{...owner,body:{name:'Northstar Supply',domains:['northstar.example'],attributes:{}}})).company
 for(const person of contacts)await app.ok(`${base}/companies/${company.id}/members/${person.contact_id}`,{...owner,method:'PUT',body:{}})
 const tickets=[]
 for(let i=0;i<3;i++)tickets.push((await app.ok(`${api}/${form.id}/submissions`,{...people[i%3],body:{...valid,localId:'company-order-'+i,subject:`Northstar delivery ${10482+i}`}})).ticket)
 const own=(await app.ok(P+'/tickets',people[0])).tickets
 assert.equal(own.length,1,'company entitlement starts off')
 assert.equal((await app.call(P+`/tickets/${tickets[1].id}`,people[0])).status,404)
 await app.ok(`${base}/companies/${company.id}`,{...owner,method:'PATCH',body:{portalCompanyView:true}})
 assert.equal((await app.ok(P+'/tickets',people[0])).tickets.length,3)
 const upload=await app.ok(P+`/tickets/${tickets[1].id}/attachments`,{...people[1],raw:true,body:'Northstar shipping manifest',headers:{...people[1].headers,'Content-Type':'text/plain','X-Filename':'manifest.txt'}})
 const shared=(await app.ok(P+`/tickets/${tickets[1].id}`,people[0])).ticket
 const reply=await app.ok(P+`/tickets/${shared.id}/reply`,{...people[0],body:{localId:'alex-company-reply',content:'I coordinate deliveries for Northstar. Please use our loading dock.',expectedRevision:shared.revision,mediaIds:[]}})
 assert.equal((await app.first('SELECT actor_id FROM messages WHERE id=?',reply.messageId)).actor_id,contacts[0].contact_id,'company replies keep the actual author')
 const beaTicket=(await app.ok(P+`/tickets/${shared.id}`,people[1])).ticket
 await app.ok(P+`/tickets/${shared.id}/reply`,{...people[1],body:{localId:'company-file',content:'The shipping manifest is attached.',expectedRevision:beaTicket.revision,mediaIds:[upload.id]}})
 const file=P+`/tickets/${shared.id}/attachments/${upload.id}`,download=await app.request(file,people[0]);assert.equal(download.status,200);assert.equal(await download.text(),'Northstar shipping manifest')
 await app.ok(`/api/dashboard/projects/${p}/conversations/${shared.id}`,{...owner,method:'PUT',body:{resolved:true}})
 const solved=(await app.ok(P+`/tickets/${shared.id}`,people[0])).ticket
 await app.ok(P+`/tickets/${shared.id}/reopen`,{...people[0],body:{expectedRevision:solved.revision}})
 assert.equal((await app.ok(P+`/tickets/${shared.id}`,people[0])).ticket.status,'open')
 const outsider=await signin('outside@example.net'),outside=(await app.ok(`${api}/${form.id}/submissions`,{...outsider,body:{...valid,localId:'outside-company'}})).ticket
 assert.equal((await app.call(file,outsider)).status,404)
 assert.deepEqual(new Set((await app.ok(`/api/dashboard/projects/${p}/conversations?view=all&company=${company.id}`,owner)).data.map(ticket=>ticket.id)),new Set(tickets.map(ticket=>ticket.id)))
 for(const action of ['', '/reply'])assert.equal((await app.call(P+`/tickets/${outside.id}${action}`,{...people[0],...(action?{body:{localId:'outside-reply',content:'No access',expectedRevision:1}}:{})})).status,404)
 await app.ok(`${base}/companies/${company.id}/members/${contacts[0].contact_id}`,{...owner,method:'DELETE'})
 assert.equal((await app.call(P+`/tickets/${shared.id}`,people[0])).status,404,'membership removal is immediate')
 assert.equal((await app.call(file,people[0])).status,404,'membership removal fences existing attachment links')
 await app.ok(`${base}/companies/${company.id}`,{...owner,method:'PATCH',body:{portalCompanyView:false}})
 assert.equal((await app.ok(P+'/tickets',people[1])).tickets.length,1,'entitlement removal is immediate')
 assert.equal((await app.call(P+`/tickets/${tickets[2].id}`,people[1])).status,404)
}
