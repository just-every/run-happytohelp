import test from 'node:test'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {launchBrowser,evidence} from './kit/browser.mjs'
import {useBrowserJourney} from '../helpers/delegation/browser-use.mjs'

test('a paired computer publishes the requested help article; the operator reviews its draft with Use, sends once, and the visitor receives the same reply after reload',async()=>{
 const runtime=await createRuntime({vars:{RER_INSTALLATION_ID:'delegation-browser-installation'}}),browser=await launchBrowser()
 let passed=false
 try{await useBrowserJourney({runtime,browser,shot:await evidence('delegation')});passed=true}
 finally{await browser.close();await runtime.close(passed)}
})
