import {legacyCustodyJourney,legacyCustodyOverlapJourney} from '/home/agent/rer-consolidation/work/hh-importer-custody-2/repo/tests/helpers/legacy-custody/journey.mjs'
await legacyCustodyJourney()
await legacyCustodyOverlapJourney()
console.log('custody real D1/R2 harness passed')
