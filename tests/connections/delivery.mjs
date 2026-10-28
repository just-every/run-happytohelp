import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {body} from './harness.mjs'

const root='/api/management/projects/p/connections'
function verify(receipt,destination){
 const h=receipt.headers
 assert.equal(h['webhook-tenant'],'p');assert.equal(h['webhook-destination'],destination.id)
 const signed=JSON.stringify(['integrations.webhook.v1','p',destination.id,h['webhook-event'],h['webhook-id'],h['webhook-timestamp'],receipt.body.toString('utf8')])
 assert.equal(h['webhook-signature'],'v1='+createHmac('sha256',Buffer.from(destination.secret,'hex')).update(signed).digest('hex'))
}
export async function deliveryLifecycle(h,destination,receipts){
 for(const receipt of receipts){verify(receipt,destination);assert.ok(!receipt.body.toString().includes('Private warehouse context'))}
 const before=h.received.length;await h.restart();await h.dispatch();assert.equal(h.received.length,before)
 const send=async response=>{h.responses.push(response);return h.call(root+'/webhooks/'+destination.id+'/test',body({}))}
 const state=async id=>(await h.call(root+'/deliveries')).data.find(row=>row.id===id)
 // Rate-limited delivery retries the exact signed bytes, then stops on success.
 const queued=await send({status:429,headers:{'Retry-After':'0'}})
 assert.equal((await state(queued.id)).state,'queued')
 await h.db.prepare('UPDATE integration_deliveries SET next_at=0 WHERE id=?').bind(queued.id).run();await h.dispatch()
 const retry=h.received.slice(-2);assert.ok(retry[0].body.equals(retry[1].body));assert.equal(retry[0].headers['webhook-id'],retry[1].headers['webhook-id']);verify(retry[1],destination)
 assert.equal((await state(queued.id)).state,'accepted')
 const unknown=await send({status:500,body:'Private receiver failure'})
 assert.equal((await state(unknown.id)).state,'uncertain')
 const count=h.received.length;await h.restart();await h.dispatch();assert.equal(h.received.length,count)
 const approval=root+'/deliveries/'+unknown.id+'/resend'
 const approved=await Promise.all([h.raw(approval,body({attempt:1})),h.raw(approval,body({attempt:1}))]);assert.deepEqual(approved.map(response=>response.status).sort(),[202,409])
 await h.dispatch();assert.equal((await state(unknown.id)).state,'accepted');assert.equal(h.received.length,count+1)
 assert.ok(h.received[count].body.equals(h.received[count-1].body));assert.ok(!JSON.stringify(await h.call(root+'/deliveries')).includes('Private receiver failure'))
 // Redirects, an unreadably large streamed response and a lost response never
 // become acceptance or permission for automatic replay.
 const redirected=await send({status:302,headers:{Location:'https://receiver.example.com/redirect-target'}})
 assert.equal((await state(redirected.id)).state,'uncertain');assert.ok(!h.received.some(receipt=>receipt.path.endsWith('/redirect-target')))
 const oversized=await send({status:200,chunks:['x'.repeat(32768),'x'.repeat(32769)]});assert.equal((await state(oversized.id)).state,'uncertain')
 const declared=await send({status:200,headers:{'Content-Length':'65537'},body:'x'.repeat(65537)});assert.equal((await state(declared.id)).state,'uncertain')
 const timeout=await send({status:204,delay:11000});assert.equal((await state(timeout.id)).state,'uncertain')
 const stopped=h.received.length;await h.restart();await h.dispatch();assert.equal(h.received.length,stopped)
 const unsafe=await h.raw(root+'/webhooks',body({name:'Unsafe',url:'https://127.0.0.1/private',events:['conversation.created']}));assert.equal(unsafe.status,400)
 assert.ok(!JSON.stringify(await h.call(root+'/webhooks')).includes(destination.secret))
}
