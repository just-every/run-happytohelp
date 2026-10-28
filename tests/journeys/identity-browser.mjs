import test from 'node:test'
import {launchBrowser} from './kit/browser.mjs'
import {securityBrowserJourney} from '../helpers/identity/security-browser.mjs'
test('a native owner redeems mailbox proof, enrolls authenticator and passkey, signs in with a second factor, steps up an audit export and revokes only their own session',{timeout:180_000},async()=>{
 const browser=await launchBrowser()
 try{await securityBrowserJourney(browser)}finally{await browser.close()}
})
