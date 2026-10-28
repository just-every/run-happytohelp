import test from 'node:test'
import {launchBrowser} from './kit/browser.mjs'
import {securityBrowserJourney} from '../helpers/identity/security-browser.mjs'

test('an owner explicitly redeems a scanner-safe sign-in link, enrolls factors, signs in with a passkey, steps up for an audit export and signs out only the current session',async()=>{
 const browser=await launchBrowser()
 try{await securityBrowserJourney(browser)}finally{await browser.close()}
})

import {assuranceBrowserJourney} from '../helpers/assurance/browser.mjs'
test('an owner records a deployment profile and executed evidence, sees activation held for independent review, revokes an agreement and exports the qualification record at 1440',async()=>{
 const browser=await launchBrowser()
 try{await assuranceBrowserJourney(browser)}finally{await browser.close()}
})
