import assert from 'node:assert/strict'
import {workflowsJourney} from '../workflows/journey.mjs'
import {ticketFixture} from './ticket-fixture.mjs'
import {ticketLifecycle} from './ticket-lifecycle.mjs'
import {ticketQueue} from './ticket-queue.mjs'
import {ticketApiPrivacy} from './ticket-api-privacy.mjs'
export async function ticketsJourney(){
 const notices=[]
 const fixture=await ticketFixture({outbound:async request=>{assert.equal(new URL(request.url).hostname,'api.resend.com');notices.push({key:request.headers.get('idempotency-key'),body:await request.json()});return Response.json({id:'bulk-mail-'+notices.length})}})
 fixture.notices=notices
 try{await ticketLifecycle(fixture);await ticketQueue(fixture);await ticketApiPrivacy(fixture)}finally{await fixture.app.close()}
 await workflowsJourney()
}
