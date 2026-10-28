import test from 'node:test'
import {editionAuthoringJourney} from '../helpers/installer/edition-authoring.mjs'

// The public authoring CLI owns source provenance and clean release custody.
test('an author records licensed source, refuses drift and mutable origins, and releases only clean selected source without local credentials',editionAuthoringJourney)
