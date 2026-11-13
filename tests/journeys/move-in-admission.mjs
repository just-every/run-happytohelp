import {mountedErasureStates} from '../move-in/legacy-adoption-integration/erasure-states.mjs'
import {mountedOrderingJourney} from '../move-in/legacy-adoption-integration/ordering.mjs'
import {legacyAdoptionJourney} from '../helpers/legacy-adoption/journey.mjs'
import {adoptionIntegrationJourney} from '../move-in/legacy-adoption-integration/journey.mjs'
import {legacyPackageAdmission} from '../move-in/legacy-adoption-integration/admission.mjs'
import test from 'node:test'
import {inspect} from 'node:util'
import {outcomesJourney} from '../move-in/outcomes.mjs'
import {vendorRepliesJourney} from '../move-in/vendor-replies.mjs'
import {reviewImportJourney} from '../move-in/review-import.mjs'

test('review an export, import its history and private notes, repeat and repackage without effects, then undo exactly',{timeout:480_000},async()=>{
 // Every phase owns a separate installation. Keep two lanes; the measured
 // Worker uses its native V8 inspector session for profiling.
 const pending=[reviewImportJourney,adoptionIntegrationJourney,mountedErasureStates,vendorRepliesJourney,outcomesJourney,legacyPackageAdmission,legacyAdoptionJourney,mountedOrderingJourney]
 const failures=[]
 // Drain both lanes even on failure: no cleanup or outstanding assertions are
 // abandoned because an independent phase failed first.
 const run=async journey=>{
   const started=performance.now()
   try{await journey()}catch(error){
    console.error('IMPORT_ADMISSION_FAILURE',journey.name,inspect(error,{depth:null,colors:false,maxArrayLength:null,maxStringLength:null}))
    failures.push(error)
   }
   finally{console.log('IMPORT_ADMISSION_PHASE',JSON.stringify({journey:journey.name,duration_ms:Math.round(performance.now()-started)}))}
 }
 const lane=async()=>{while(pending.length)await run(pending.shift())}
 await Promise.all([lane(),lane()])
 if(failures.length)throw new AggregateError(failures,'Importer admission phase failed')
})
