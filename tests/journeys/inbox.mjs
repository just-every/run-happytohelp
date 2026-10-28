import {companyRecordsJourney} from '../helpers/company-records.mjs'
import {customerCsvJourney} from '../helpers/customer-csv.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {startApp} from './kit/app.mjs'
import {ticketsJourney} from '../helpers/inbox/tickets.mjs'
import {managementJourney} from '../helpers/inbox/management.mjs'
import {inboxSearchJourney} from '../helpers/inbox/search.mjs'
import {artworkJourney} from '../helpers/inbox/artwork.mjs'
import {libraryValidationJourney} from '../helpers/inbox/library-validation.mjs'
import {appearanceJourney} from '../helpers/inbox/appearance.mjs'

// The operator's workspace on the real application's routes; fixtures only at the mail provider, DNS and crawler.

test('workspace management keeps settings, resources, bootstrap, owners, notes, participants, transcript mail, widget origins, presence and mailbox ownership within each workspace\'s current authority',async()=>{
 const app=await startApp()
 try{
  const workspace=await app.seedWorkspace('synthetic-happytohelp-1')
  const unknown=await app.request('/api/management/bootstrap?projectId=synthetic-missing',{token:workspace.tokens.operator})
  assert.equal(unknown.status,403)
  const refusal=await unknown.text(),results=[]
  for(const name of ['constructor','toString','valueOf','__proto__','hasOwnProperty'])for(const inbox of ['', '&inbox=project','&inbox=global']){
   const response=await app.request('/api/management/bootstrap?projectId='+encodeURIComponent(name)+inbox,{token:workspace.tokens.operator})
   results.push({name,inbox,status:response.status,body:await response.text()})
  }
  const open=await app.request('/api/dashboard/conversations?view=open',{token:workspace.tokens.operator})
  assert.equal(open.status,200)
  const openData=await open.json()
  for(const name of ['constructor','toString','valueOf','__proto__','hasOwnProperty'])for(const parameter of ['view','filter']){
   const response=await app.request('/api/dashboard/conversations?'+parameter+'='+encodeURIComponent(name),{token:workspace.tokens.operator})
   assert.equal(response.status,200,name+': '+await response.clone().text())
   assert.deepEqual(await response.json(),openData,name+' uses the default inbox')
  }
  for(const name of ['constructor','toString','valueOf','__proto__','hasOwnProperty'])for(const resource of ['contacts','macros']){
   const response=await app.request('/api/management/projects/'+workspace.projectId+'/'+resource+'?sort='+encodeURIComponent(name),{token:workspace.tokens.operator})
   assert.equal(response.status,400,resource+': '+await response.clone().text())
   assert.doesNotMatch(await response.text(),/binding|stack|native code/i)
  }
  for(const {name,inbox,status,body} of results){
   assert.equal(status,403,name+inbox+': '+body)
   assert.equal(body,refusal,name+inbox)
   assert.doesNotMatch(body,/binding|stack|native code/i)
  }
 }finally{await app.close()}
 await managementJourney();await companyRecordsJourney();await customerCsvJourney()
})

test('inbox search matches literally across names, emails, supplied identity and all history from an index built later and kept by every write, composes with status, assignment and AI views, and bounds its terms',inboxSearchJourney)

test('workspace artwork is shared with members, changed only by permitted roles within the workspace, and stored and cleaned up atomically',artworkJourney)

test('library inputs are validated before storage: crawl limits, contacts without an identifier and the last owner are refused, and stored out-of-range limits never start the crawler',libraryValidationJourney)

test('appearance settings persist whole or not at all, keep Unicode and limits, reset cleanly, respect roles and tenants, and the public brand never shows older invalid values',appearanceJourney)

test('tickets carry typed fields, scoped teams and lifecycle history through customer replies, saved views, previewed bulk changes, the API and erasure',ticketsJourney)

import {macrosJourney} from '../helpers/r4/macros.mjs'
import {collaborationJourney} from '../helpers/r4/collaboration.mjs'
import {conversationActionsJourney} from '../helpers/r4/conversation-actions.mjs'
test('action macros preview and apply scoped versioned changes and attachments to a ticket and thirty tickets, preserve editable drafts and block unresolved sends',macrosJourney)
test('teammates collaborate with private mentions, followers and live viewing, typing and draft collision warnings while visitors retain their own scope',collaborationJourney)
test('duplicate tickets merge into a surviving operator thread with safe undo and private partner replies through the real mail gateways',conversationActionsJourney)

import {brandsJourney} from '../helpers/inbox/brands.mjs'
test('two brands deliberately share a team while domains, senders, signatures, customer identities, private knowledge, routing and policy stay isolated, reports aggregate only permitted brands and revocation ends access',brandsJourney)
