import {mountedErasureStates} from '../move-in/legacy-adoption-integration/erasure-states.mjs'
import {mountedOrderingJourney} from '../move-in/legacy-adoption-integration/ordering.mjs'
import {legacyAdoptionJourney} from '../helpers/legacy-adoption/journey.mjs'
import {adoptionIntegrationJourney} from '../move-in/legacy-adoption-integration/journey.mjs'
import {legacyPackageAdmission} from '../move-in/legacy-adoption-integration/admission.mjs'
import test from 'node:test'
import {outcomesJourney} from '../move-in/outcomes.mjs'
import {vendorRepliesJourney} from '../move-in/vendor-replies.mjs'
import {reviewImportJourney} from '../move-in/review-import.mjs'

test('review an export, import its history and private notes, repeat and repackage without effects, then undo exactly',{timeout:480_000},async()=>{
 for(const journey of [reviewImportJourney,outcomesJourney,vendorRepliesJourney,legacyPackageAdmission,adoptionIntegrationJourney,legacyAdoptionJourney,mountedOrderingJourney,mountedErasureStates]){
  const started=performance.now()
  await journey()
  console.log('IMPORT_ADMISSION_PHASE',JSON.stringify({journey:journey.name,duration_ms:Math.round(performance.now()-started)}))
 }
})
