import test from 'node:test'
import {capacityJourney} from '../move-in/capacity-journey.mjs'

// Release/nightly only. The vendor table exercises one capacity/reversal flow.
test('1,000-conversation exports import within platform and heap bounds, repeat without writes and undo exactly',{timeout:30*60_000},async()=>{
 for(const vendor of ['zendesk','intercom','helpscout'])await capacityJourney(vendor,1000)
})
