import test from 'node:test'
import {firstRunBrowser} from '../helpers/first-run/first-run-browser.mjs'
import {setupBrowser} from '../helpers/first-run/native-setup-browser.mjs'
import {activationBrowser} from '../helpers/first-run/activation-browser.mjs'
import {aiControlsBrowser} from '../helpers/first-run/ai-controls-browser.mjs'
import {knowledgeActivationBrowser} from '../helpers/first-run/knowledge-activation-browser.mjs'
import {readinessBrowser} from '../helpers/first-run/readiness-browser.mjs'
import {dashboardBrowser} from '../helpers/first-run/dashboard-browser.mjs'
import {profileBrowser} from '../helpers/first-run/profile-browser.mjs'
import {managedMailBrowser} from '../helpers/first-run/managed-mail-browser.mjs'

// The first run in Chromium against the emitted Worker; each case starts its own installation.

// Each installation mode proves the owner can complete setup and handle the
// first customer reply, with its actual mail readiness visible at both widths.
test('first run at 1440 and 390 with local, native and Managed mail: the one-screen setup, the local owner, the installed widget and a customer reply, email sign-in only where mail is configured, and visible uncertain or failed mail readiness',{timeout:30*60_000},async()=>{
 for(const journey of [setupBrowser,firstRunBrowser,managedMailBrowser])await journey()
})

test('the Setup page and AI controls: fresh, local and provider observations, knowledge, demo and spend views, widget pings, and assistant model and key controls',{timeout:20*60_000},async()=>{await activationBrowser();await aiControlsBrowser()})

test('knowledge on Setup: an article and a website source published, cited by the assistant, a failed refresh retaining the corpus',{timeout:20*60_000},knowledgeActivationBrowser)

test('the dashboard is ready before it acts, every first-run section and route variant works at 1440 and 390, and a returning visitor\'s profile reloads without writes',{timeout:20*60_000},async()=>{await readinessBrowser();await dashboardBrowser();await profileBrowser()})
