import {workflowsJourney} from '../workflows/journey.mjs'
import {ticketFixture} from './ticket-fixture.mjs'
import {ticketLifecycle} from './ticket-lifecycle.mjs'
import {ticketQueue} from './ticket-queue.mjs'
import {ticketApiPrivacy} from './ticket-api-privacy.mjs'
export async function ticketsJourney(){
 const fixture=await ticketFixture()
 try{await ticketLifecycle(fixture);await ticketQueue(fixture);await ticketApiPrivacy(fixture)}finally{await fixture.app.close()}
 await workflowsJourney()
}
