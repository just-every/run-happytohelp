import {triageBrowserJourney} from '../helpers/ai/triage-browser.mjs'
import test,{before,after} from 'node:test'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {launchBrowser,viewports,evidence} from './kit/browser.mjs'
import {trainingBrowserJourney} from '../helpers/ai/training-browser.mjs'
import {suggestionsAtWidth} from '../helpers/ai/suggestions-browser.mjs'

// The assistant's operator pages in the emitted Worker and Chromium; only the model provider is a fixture.
let runtime,browser,shot,passed=true
before(async()=>{runtime=await createRuntime({queueConsumers:true,vars:{OPENAI_API_KEY:'sk-test',H2H_LOCAL:'true',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test'},outboundFixture:new URL('../helpers/ai/triage-network.mjs',import.meta.url).href});browser=await launchBrowser();shot=await evidence('ai')})
after(async()=>{await browser?.close();await runtime?.close(passed)})
const recorded=work=>async()=>{try{await work()}catch(error){passed=false;throw error}}

test('evaluation runs at 1440 and 390 show only real native state: loading and failed reads are never a list, recovery is explicit, stale responses never repaint, and a pending creation is never replayed',recorded(()=>trainingBrowserJourney({runtime,browser,shot})))

test('the AI panel at 1440 and 390 waits for a customer message, requests suggestions once per Enter in the instructions, keeps Shift+Enter as a newline, and shows the cards without sending',recorded(async()=>{for(const viewport of Object.values(viewports))await suggestionsAtWidth({runtime,browser,shot,viewport});await triageBrowserJourney({runtime,browser,shot})}))
