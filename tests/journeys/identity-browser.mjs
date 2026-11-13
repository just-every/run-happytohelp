import test from 'node:test'
import {launchBrowser} from './kit/browser.mjs'
import {securityBrowserJourney} from '../helpers/identity/security-browser.mjs'
import {legacyMoveInAuthReturn} from '../move-in/legacy-package-upload/auth-return.mjs'

test('an owner explicitly redeems a scanner-safe sign-in link, enrolls factors, signs in with a passkey, steps up for an audit export and signs out only the current session',async()=>{
 const browser=await launchBrowser()
 try{await securityBrowserJourney(browser);await legacyMoveInAuthReturn(browser)}finally{await browser.close()}
})

import {assuranceBrowserJourney} from '../helpers/assurance/browser.mjs'
test('an owner records a deployment profile and executed evidence, sees activation held for independent review, revokes an agreement and exports the qualification record at 1440',async()=>{
 const browser=await launchBrowser()
 try{await assuranceBrowserJourney(browser)}finally{await browser.close()}
})

import {builtOutcomes} from '../helpers/first-run/outcomes.mjs'
import {activationBrowserJourney} from '../helpers/first-run/activation-browser.mjs'
test('a first owner and a signed-in owner reach Setup and install a working widget',async()=>{await builtOutcomes();await localEmailSetupBrowser()})
test('Setup observes receipts, protects keys and preserves uncertain mail across restarts',activationBrowserJourney)

import {widgetIdentitySwitchBrowser} from '../helpers/widget/identity-switch-browser.mjs'
test('in one browser the widget keeps every visitor to its own conversation across sign-in, sign-out, account switches and shutdown',async()=>{
 const browser=await launchBrowser()
 try{await widgetIdentitySwitchBrowser(browser)}finally{await browser.close()}
})

import {recoveryBrowserJourney} from '../helpers/identity/recovery-browser/journey.mjs'
test('lost-factor recovery collects every workspace consent, proves a replacement, preserves access and exposes no session before completion',async()=>{
 const browser=await launchBrowser();try{await recoveryBrowserJourney(browser)}finally{await browser.close()}
})
import {localEmailSetupBrowser} from '../helpers/email/setup-browser.mjs'
