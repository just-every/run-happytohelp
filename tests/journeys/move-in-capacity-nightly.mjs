import test from 'node:test'
import {capacityJourney} from '../move-in/capacity-journey.mjs'

// A seeded 1,000-conversation export for each supported vendor, end to end through the real import door.
for(const vendor of ['zendesk','intercom','helpscout'])test(`a 1,000-conversation ${vendor} export imports within invocation, statement and heap bounds, repeats with no writes and undoes to exact prior business state`,{timeout:15*60_000},()=>capacityJourney(vendor,1000))
