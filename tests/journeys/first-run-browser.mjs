import test from 'node:test'
import {firstRunBrowser} from '../helpers/first-run/first-run-browser.mjs'
import {setupBrowser} from '../helpers/first-run/native-setup-browser.mjs'
import {activationBrowser} from '../helpers/first-run/activation-browser.mjs'
import {aiControlsBrowser} from '../helpers/first-run/ai-controls-browser.mjs'
import {knowledgeActivationBrowser} from '../helpers/first-run/knowledge-activation-browser.mjs'
import {readinessBrowser} from '../helpers/first-run/readiness-browser.mjs'
import {dashboardBrowser} from '../helpers/first-run/dashboard-browser.mjs'
import {profileBrowser} from '../helpers/first-run/profile-browser.mjs'

// The first run in Chromium against the emitted Worker; each case starts its own installation.

test('first run at 1440 and 390: the one-screen setup, the local owner, the installed widget and a customer reply, and email sign-in only where mail is configured',{timeout:20*60_000},async()=>{await setupBrowser();await firstRunBrowser()})

test('the Setup page and AI controls: fresh, local and provider observations, knowledge, demo and spend views, widget pings, and assistant model and key controls',{timeout:20*60_000},async()=>{await activationBrowser();await aiControlsBrowser()})

test('knowledge on Setup: an article and a website source published, cited by the assistant, a failed refresh retaining the corpus',{timeout:20*60_000},knowledgeActivationBrowser)

test('the dashboard is ready before it acts, native controls and workspace switching work at 1440 and 390, and a returning visitor\'s profile reloads without writes',{timeout:20*60_000},async()=>{await readinessBrowser();await dashboardBrowser();await profileBrowser()})
