import test from 'node:test'
import {publicationJourney} from '../helpers/knowledge/publication.mjs'
import {githubJourney} from '../helpers/knowledge/github.mjs'
import {previewJourney} from '../helpers/knowledge/preview.mjs'
import {csatJourney} from '../helpers/csat-journey.mjs'

// Knowledge on the real application: routes, queue stages run as the queue would,
// and fixtures only at the crawler, embedding, vector, help-center, GitHub and image providers.

test('knowledge publication lifecycle: retained source citations become reviewed articles, scoped search and audience-gated help; failed refreshes preserve the last usable version',publicationJourney)

test('GitHub connects through one-use OAuth into an encrypted credential and discovers only the selected repositories in each credential mode; provider failures, contacts and other workspaces are refused',githubJourney)

test('a brand image is paid once per request and fenced when uncertain, assets are public only once published, and a website preview is isolated, sandboxed, credential-free and ends with its grant',previewJourney)

test('a solved native conversation emails one signed satisfaction survey, records its response and reason in reports, refuses reuse, and respects opt-out, widget feedback, imports and machine mail',csatJourney)

test('a translated request form enforces typed conditional required fields on the server, protects anonymous submissions, and admits one ticket after email verification',async()=>{const {requestFormsJourney}=await import('../helpers/request-forms-journey.mjs');await requestFormsJourney()})

test('customers sign into their own portal by email, reply with attachments, answer a signed survey, reopen a solved request and control notifications while other identities and erased sessions are denied',async()=>{const {customerPortalJourney}=await import('../helpers/customer-portal-journey.mjs');await customerPortalJourney()})
