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
 // Each phase owns a separate installation. Start the two longest first and
 // overlap two phases, retaining their internal order and fresh-state checks.
 const pending=[reviewImportJourney,adoptionIntegrationJourney,mountedErasureStates,vendorRepliesJourney,outcomesJourney,legacyPackageAdmission,legacyAdoptionJourney,mountedOrderingJourney]
 // Drain both lanes even on failure: no cleanup or outstanding assertions are
 // abandoned because an independent phase failed first.
 const lane=async()=>{
  const failures=[]
  while(pending.length){
   const journey=pending.shift(),started=performance.now()
   try{await journey()}catch(error){failures.push(error)}
   finally{console.log('IMPORT_ADMISSION_PHASE',JSON.stringify({journey:journey.name,duration_ms:Math.round(performance.now()-started)}))}
  }
  return failures
 }
 const failures=(await Promise.all([lane(),lane()])).flat()
 if(failures.length)throw new AggregateError(failures,'Importer admission phase failed')
})
