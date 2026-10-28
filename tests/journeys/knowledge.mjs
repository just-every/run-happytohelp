import test from 'node:test'
import {authoringJourney} from '../helpers/knowledge/authoring.mjs'
import {customerPortalJourney} from '../helpers/customer-portal-journey.mjs'

test('an owner publishes searchable help and removes it through article and workspace lifecycle while drafts and foreign records stay private',authoringJourney)
test('customers create, reply to and reopen their own requests, with company access and attachments revoked immediately when authority ends',customerPortalJourney)

import {previewJourney} from '../helpers/knowledge/preview.mjs'
test('an owner publishes one brand asset and previews only the allowed website without credentials, while uncertain paid images and revoked preview grants stay fenced',previewJourney)
