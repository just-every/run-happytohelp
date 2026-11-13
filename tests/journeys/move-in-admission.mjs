import {mountedErasureStates} from '../move-in/legacy-adoption-integration/erasure-states.mjs'
import {mountedOrderingJourney} from '../move-in/legacy-adoption-integration/ordering.mjs'
import {legacyAdoptionJourney} from '../helpers/legacy-adoption/journey.mjs'
import {adoptionIntegrationJourney} from '../move-in/legacy-adoption-integration/journey.mjs'
import {legacyPackageAdmission} from '../move-in/legacy-adoption-integration/admission.mjs'
import test from 'node:test'
import {outcomesJourney} from '../move-in/outcomes.mjs'
import {vendorRepliesJourney} from '../move-in/vendor-replies.mjs'
import {reviewImportJourney} from '../move-in/review-import.mjs'

// Each phase owns fresh installations. Await registrations as well as phases so
// this file stays sequential even when the caller enables test concurrency.
async function phases(journeys){
 for(const journey of journeys){
  const start=Date.now()
  try{await journey()}finally{console.log('IMPORT_ADMISSION_PHASE',JSON.stringify({journey:journey.name,duration_ms:Date.now()-start}))}
 }
}

await test('review an export, import its history and private notes, repeat and repackage without effects, then undo exactly',{timeout:480_000},async()=>{
 await phases([reviewImportJourney])
})

await test('admit a legacy package, recover mounted adoption and refuse unauthorized outcomes',{timeout:480_000},async()=>{
 await phases([legacyPackageAdmission,adoptionIntegrationJourney,outcomesJourney])
})

await test('erase mounted import states, preserve vendor replies and enforce legacy ordering',{timeout:480_000},async()=>{
 await phases([mountedErasureStates,vendorRepliesJourney,legacyAdoptionJourney,mountedOrderingJourney])
})
