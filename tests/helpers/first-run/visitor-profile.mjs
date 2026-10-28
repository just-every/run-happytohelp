import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'

// The same signed visitor resumes, supplies collector details, reads the current
// profile and loses it on erasure. Claimed identity never replaces signed fields.
export async function visitorProfileJourney(){
 const app=await startApp({origin:'https://app.example'})
 try{
  const w=await app.seedWorkspace('profile',{allowedOrigin:'https://widget.example'}),other=await app.seedWorkspace('other-profile')
  const secret=(await app.first('SELECT verification_secret FROM projects WHERE id=?',w.projectId)).verification_secret
  const body={widgetKey:w.widgetKey,identifier:'account-42',name:'Avery Account',email:'avery@example.test'}
  body.contact_hash=createHmac('sha256',secret).update(body.identifier).digest('hex')
  const session=async input=>(await app.call('/api/identity/widget/session',{body:input,headers:{Origin:w.allowedOrigin},status:201})).data
  const visitor=await session(body),resumed=await session(body)
  assert.equal(resumed.contactId,visitor.contactId)
  const unsigned=await session({...body,contact_hash:undefined})
  assert.notEqual(unsigned.contactId,visitor.contactId)
  assert.equal((await app.call('/api/identity/widget/session',{body:{...body,contact_hash:'0'.repeat(64)}})).status,403)
  const conversation=await app.ok('/api/conversations',{token:visitor.token,body:{projectId:w.projectId}})
  const profile=options=>app.call('/api/identity/widget/profile',{token:visitor.token,...options})
  const initial=await profile();assert.equal(initial.status,200);assert.match(initial.headers.get('Cache-Control'),/no-store/)
  assert.deepEqual(initial.data.contact,{id:visitor.contactId,name:body.name,email:body.email,verified:true})
  const contactBefore=await app.first('SELECT * FROM contacts WHERE id=?',visitor.contactId)
  assert.equal((await profile()).data.contact.id,visitor.contactId)
  assert.deepEqual(await app.first('SELECT * FROM contacts WHERE id=?',visitor.contactId),contactBefore,'profile hydration changes no customer data')
  const collect=async token=>app.call(`/api/conversations/${conversation.id}/widget-events`,{token,body:{action:'contact',data:{name:'Visitor alias',email:'alias@example.test',external_id:'forged-account',is_verified:0}}})
  assert.equal((await collect(unsigned.token)).status,404)
  const collected=await collect(visitor.token);assert.equal(collected.status,200)
  assert.deepEqual((await profile()).data.contact,initial.data.contact)
  const stored=await app.first('SELECT metadata_json FROM contacts WHERE id=?',visitor.contactId),provided=JSON.parse(stored.metadata_json)
  assert.equal(provided.provided_name,'Visitor alias');assert.equal(provided.provided_email,'alias@example.test')
  assert.ok(!JSON.stringify((await profile()).data).includes('provided_email'))
  assert.equal((await profile({headers:{Origin:'https://foreign.test'}})).status,403)
  assert.equal((await app.call('/api/identity/widget/profile',{token:w.tokens.owner})).status,404)
  assert.equal((await app.call(`/api/management/projects/${w.projectId}/contacts/${visitor.contactId}/erase`,{token:other.tokens.owner,body:{}})).status,403)
  await app.ok(`/api/management/projects/${w.projectId}/contacts/${visitor.contactId}/erase`,{token:w.tokens.owner,body:{}})
  assert.equal((await profile()).status,401)
  assert.equal((await collect(visitor.token)).status,401)
  assert.equal(app.requests.length,0)
 }finally{await app.close()}
}
