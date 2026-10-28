import test from 'node:test'
import {ticketsBrowser} from '../helpers/inbox/tickets-browser.mjs'
import {triageBrowserJourney} from '../helpers/ai/triage-browser.mjs'
import {launchBrowser,evidence} from './kit/browser.mjs'

test('a support lead configures ticket fields and a queue, previews and applies bulk changes, then previews, publishes and pauses its versioned workflow',()=>ticketsBrowser())

test('a support lead reviews measured triage accuracy, approves prediction routing and corrects the evidence on a real admitted customer ticket',async()=>{
 const browser=await launchBrowser()
 try{await triageBrowserJourney({browser,shot:await evidence('triage')})}finally{await browser.close()}
})

import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {proceduresBrowserJourney} from '../helpers/ai/procedures-browser.mjs'
test('a lead compares saved procedure definitions, revises an older version without losing unsaved work or source receipts, and requires fresh evaluation before any release',async()=>{
 const runtime=await createRuntime({queueConsumers:true,vars:{OPENAI_API_KEY:'synthetic-hh-1',TRAINING_PRICE_CEILINGS:JSON.stringify({'gpt-5.6-luna':{inputPerMillion:5,outputPerMillion:20}})},outboundFixture:new URL('../helpers/ai/suggestion-network.mjs',import.meta.url).href}),browser=await launchBrowser()
 let passed=false
 try{await proceduresBrowserJourney({runtime,browser,shot:await evidence('procedures')});passed=true}
 finally{await browser.close();await runtime.close(passed)}
})

import {randomBytes} from 'node:crypto'
import {feedbackBrowserJourney} from '../helpers/feedback/browser.mjs'
test('an operator links a customer quote, hands it to Penny with explicit permission, receives a signed release and approves one service update while recovery stays unconfirmed',async()=>{
 const runtime=await createRuntime({vars:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')},outboundFixture:new URL('../helpers/feedback/outbound.mjs',import.meta.url).href}),browser=await launchBrowser()
 let passed=false
 try{const owner=await runtime.seedTenant({name:'Ridgeline product feedback',email:'synthetic-happytohelp-8@example.test'});await feedbackBrowserJourney({browser,origin:runtime.origin,owner,width:1440,directory:(await evidence('feedback'))('')});passed=true}
 finally{await browser.close();await runtime.close(passed)}
})

import {hubspotBrowser} from '../helpers/hubspot/browser.mjs'
test('an owner maps and refreshes HubSpot context while unsaved edits and revoked permissions remain safe',async()=>{
 const browser=await launchBrowser()
 try{await hubspotBrowser({browser,directory:(await evidence('hubspot'))('')})}finally{await browser.close()}
})
