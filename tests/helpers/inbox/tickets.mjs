import {inboxSearchFlow} from './search.mjs'
import {collaborationFlow} from '../r4/collaboration.mjs'
import assert from 'node:assert/strict'
import {workflowsJourney} from '../workflows/journey.mjs'
import {ticketFixture} from './ticket-fixture.mjs'
import {ticketLifecycle} from './ticket-lifecycle.mjs'
import {ticketQueue} from './ticket-queue.mjs'
import {ticketApiPrivacy} from './ticket-api-privacy.mjs'
export async function ticketsJourney(){
 const notices=[],network={phase:'desk',slack:{requests:[],responses:[]}}
 // This populated queue deliberately generates many customer turns; admission limits have their own public-door journey.
 const fixture=await ticketFixture({bindings:{RATE_LIMITS:JSON.stringify({messagesPerContactHour:1000}),INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,4).toString('base64')},outbound:async request=>{
  const url=new URL(request.url)
  if(url.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.test.'}]})
  if(url.hostname==='hooks.slack.com'){
   network.slack.requests.push(await request.json());const response=network.slack.responses.shift()??{status:200,body:'ok'}
   if(response.lost)throw new TypeError('Synthetic lost response')
   return new Response(response.body,{status:response.status,headers:response.headers})
  }
  if(url.hostname==='hooks.example.com'){if(url.pathname==='/lost')throw new TypeError('Connection reset after request body');return new Response('',{status:url.pathname==='/reject'?422:200})}
  assert.equal(url.hostname,'api.resend.com')
  if(network.phase==='workflows')throw new TypeError('Connection reset after request body was received')
  notices.push({key:request.headers.get('idempotency-key'),body:await request.json()});return Response.json({id:'bulk-mail-'+notices.length})
 }})
 fixture.notices=notices;fixture.network=network
 try{
  await ticketLifecycle(fixture)
  await ticketQueue(fixture)
  await inboxSearchFlow(fixture)
  await collaborationFlow(fixture)
  await ticketApiPrivacy(fixture)
  network.phase='workflows'
  const workflows=await workflowsJourney(fixture)
  await workflows.finishErasure(fixture.finishTicketErasure)
  assert.deepEqual((await fixture.app.ok(`${fixture.base}/conversations?q=`+encodeURIComponent(fixture.searchErasureQuery),{token:fixture.w.tokens.owner})).data,[],'erasure also removes searchable history')
 }finally{await fixture.app.close()}
}
