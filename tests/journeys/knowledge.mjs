import test from 'node:test'
import {authoringJourney} from '../helpers/knowledge/authoring.mjs'
import {customerPortalJourney} from '../helpers/customer-portal-journey.mjs'

test('an owner publishes searchable help and removes it through article and workspace lifecycle while drafts and foreign records stay private',authoringJourney)
test('customers create, reply to and reopen their own requests, with company access and attachments revoked immediately when authority ends',customerPortalJourney)

import {previewJourney} from '../helpers/knowledge/preview.mjs'
test('an owner publishes one brand asset and previews only the allowed website without credentials, while uncertain paid images and revoked preview grants stay fenced',previewJourney)

import {proposalsJourney} from '../helpers/knowledge/proposals.mjs'
import {requestFormsJourney} from '../helpers/request-forms-journey.mjs'
test('verified support resolutions become cited redacted drafts under named editorial authority without automatic publication',proposalsJourney)
test('a translated request admits typed conditional values and attributes its prior article view exactly once through replay',requestFormsJourney)
