import test from 'node:test'
import {authoringJourney} from '../helpers/knowledge/authoring.mjs'
import {sourcesJourney} from '../helpers/knowledge/sources.mjs'
import {corpusJourney} from '../helpers/knowledge/corpus.mjs'
import {recoveryJourney} from '../helpers/knowledge/recovery.mjs'
import {githubJourney} from '../helpers/knowledge/github.mjs'
import {previewJourney} from '../helpers/knowledge/preview.mjs'
import {experienceJourney} from '../helpers/knowledge/experience.mjs'
import {csatJourney} from '../helpers/csat-journey.mjs'

// Knowledge on the real application: routes, queue stages run as the queue would,
// and fixtures only at the crawler, embedding, vector, help-center, GitHub and image providers.

test('owners author articles in categories and find them, drafts included, while public help shows only this workspace\'s published articles and nothing once the workspace is deleted',authoringJourney)

test('Add URL crawls once with its saved address, exclusions and bounds, publishes into retrieval, and a failed refresh is never replayed and keeps the last corpus; invalid input or another workspace never starts a crawl',sourcesJourney)

test('a document corpus publishes over durable pages and stays in its workspace, a failed refresh keeps it, semantic retrieval is explicit and paged, and Intercom, Freshdesk and Zendesk help centers import with their hierarchy and repeat identity',corpusJourney)

test('knowledge work resumes from durable state after refused or lost queue sends, never replays uncertain paid work, and a deleted workspace makes no further provider calls, keeps its corpus and never starves a live one',recoveryJourney)

test('GitHub connects through one-use OAuth into an encrypted credential and discovers only the selected repositories in each credential mode; provider failures, contacts and other workspaces are refused',githubJourney)

test('a brand image is paid once per request and fenced when uncertain, assets are public only once published, and a website preview is isolated, sandboxed, credential-free and ends with its grant',previewJourney)

test('customers see only their permitted reviewed knowledge in public search and ticket insertion; versions, redirects, templates, feedback and analytics remain scoped',async()=>{await experienceJourney();await (await import('../helpers/knowledge/proposals.mjs')).proposalsJourney()})

test('a solved native conversation emails one signed satisfaction survey, records its response and reason in reports, refuses reuse, and respects opt-out, widget feedback, imports and machine mail',csatJourney)

test('a translated request form enforces typed conditional required fields on the server, protects anonymous submissions, and admits one ticket after email verification',async()=>{const {requestFormsJourney}=await import('../helpers/request-forms-journey.mjs');await requestFormsJourney()})

test('customers sign into their own portal by email, reply with attachments, answer a signed survey, reopen a solved request and control notifications while other identities and erased sessions are denied',async()=>{const {customerPortalJourney}=await import('../helpers/customer-portal-journey.mjs');await customerPortalJourney()})
