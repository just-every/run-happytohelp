import test from 'node:test'
import {legacyCustodyOverlapJourney} from '../helpers/legacy-custody/journey.mjs'
import {importErasureJourney} from '../move-in/erasure-journey.mjs'

test('erase an imported customer across reviewed, rejected and pending alias uploads; revoke their transcript and attachments while preserving the peer',{timeout:180_000},async()=>{await importErasureJourney();await legacyCustodyOverlapJourney()})
