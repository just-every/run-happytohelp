import test from 'node:test'
import {companyRecordsJourney} from '../helpers/company-records.mjs'
import {customerCsvJourney} from '../helpers/customer-csv.mjs'

test('a support team manages an account and its members, reviews and reverses an identity association without sharing customer authority, and erases its provenance',companyRecordsJourney)
test('an owner previews mapped customer and company CSVs, imports and reverses them without contacting anyone, while later edits and erasure protect retained records',customerCsvJourney)

import {writtenContactsJourney} from '../helpers/owner-journey-inbox.mjs';
test('the owner can hide page visitors without losing writers, email contacts, search matches or correct pagination',writtenContactsJourney);
