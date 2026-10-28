import test from 'node:test'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {proceduresBrowserJourney} from '../helpers/ai/procedures-browser.mjs'
import {launchBrowser,evidence} from './kit/browser.mjs'

// One operator follows the same immutable procedure from draft through receipts and saved revisions.
test('a lead saves, compares and revises immutable procedures, inspects synthetic outcomes and qualifies only verified versions',{timeout:180_000},async()=>{
 const runtime=await createRuntime({queueConsumers:true,vars:{OPENAI_API_KEY:'synthetic-hh-1',TRAINING_PRICE_CEILINGS:JSON.stringify({'gpt-5.6-luna':{inputPerMillion:5,outputPerMillion:20}})},outboundFixture:new URL('../helpers/ai/suggestion-network.mjs',import.meta.url).href})
 let browser,passed=false
 try{
  browser=await launchBrowser()
  await proceduresBrowserJourney({runtime,browser,shot:await evidence('procedures')})
  passed=true
 }finally{await browser?.close();await runtime.close(passed)}
})
