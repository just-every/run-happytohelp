import test,{before,after} from 'node:test'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {launchBrowser,evidence} from './kit/browser.mjs'
import {useBrowserJourney} from '../helpers/delegation/browser-use.mjs'

// Delegation in the emitted Worker with real local D1/R2/sockets and Chromium.
// Only the paid provider CLI is scripted; each case has its own workspaces.
let runtime,browser,shot,passed=true
before(async()=>{runtime=await createRuntime({vars:{RER_INSTALLATION_ID:'delegation-browser-installation'}});browser=await launchBrowser();shot=await evidence('delegation')})
after(async()=>{await browser?.close();await runtime?.close(passed)})
const recorded=work=>async()=>{try{await work({runtime,browser,shot})}catch(error){passed=false;throw error}}

test('a paired connector investigates and repairs a customer request, provides a separate readback and hands its proposed reply to the person for explicit Send',{timeout:180_000},recorded(useBrowserJourney))
