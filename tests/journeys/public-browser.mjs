import test from 'node:test'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {homepageJourney} from '../homepage-browser.mjs'
import {launchBrowser,viewports,evidence} from './kit/browser.mjs'

test('a new owner finds the source and installation guide from the public product page, and recovers from a missing documentation page',async()=>{
 const runtime=await createRuntime(),browser=await launchBrowser()
 let passed=false
 try{
  const context=await browser.newContext({viewport:viewports.desktop}),page=await context.newPage()
  await homepageJourney({page,origin:runtime.origin,shot:await evidence('public')})
  passed=true
 }finally{await browser.close();await runtime.close(passed)}
})
