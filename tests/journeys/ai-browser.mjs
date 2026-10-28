import {obligationsBrowserJourney} from '../helpers/ai/obligations-browser.mjs'
import {triageBrowserJourney} from '../helpers/ai/triage-browser.mjs'
import test,{before,after} from 'node:test'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {launchBrowser,viewports,evidence} from './kit/browser.mjs'
import {trainingBrowserJourney} from '../helpers/ai/training-browser.mjs'
import {suggestionsAtWidth} from '../helpers/ai/suggestions-browser.mjs'

// The assistant's operator pages in the emitted Worker and Chromium; only the model provider is a fixture.
let runtime,browser,shot,passed=true
before(async()=>{runtime=await createRuntime({queueConsumers:true,vars:{OPENAI_API_KEY:'synthetic-hh-1',TRAINING_PRICE_CEILINGS:JSON.stringify({'gpt-5.6-luna':{inputPerMillion:5,outputPerMillion:20}})},outboundFixture:new URL('../helpers/ai/suggestion-network.mjs',import.meta.url).href});browser=await launchBrowser();shot=await evidence('ai')})
after(async()=>{await browser?.close();await runtime?.close(passed)})
const recorded=work=>async()=>{try{await work()}catch(error){passed=false;throw error}}

test('evaluation runs at 1440 and 390 show only real native state: loading and failed reads are never a list, recovery is explicit, stale responses never repaint, and a pending creation is never replayed',recorded(async()=>{await trainingBrowserJourney({runtime,browser,shot});await (await import('../helpers/ai/procedures-browser.mjs')).proceduresBrowserJourney({runtime,browser,shot})}))

test('the AI panel at 1440 and 390 waits for a customer message, requests suggestions once per Enter in the instructions, keeps Shift+Enter as a newline, and shows the cards without sending; triage shows measured accuracy, evidence and corrections',recorded(async()=>{for(const viewport of Object.values(viewports))await suggestionsAtWidth({runtime,browser,shot,viewport});await triageBrowserJourney({browser,shot});await obligationsBrowserJourney({runtime,browser,shot})}))
