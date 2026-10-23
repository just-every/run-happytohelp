import test,{before,after} from 'node:test'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {launchBrowser,evidence} from './kit/browser.mjs'
import {applicationsBrowserJourney} from '../helpers/delegation/browser-applications.mjs'
import {computersBrowserJourney} from '../helpers/delegation/browser-computers.mjs'
import {useBrowserJourney} from '../helpers/delegation/browser-use.mjs'

// Delegation in the emitted Worker with real local D1/R2/sockets and Chromium.
// Only the paid provider CLI is scripted; each case has its own workspaces.
let runtime,browser,shot,passed=true
before(async()=>{runtime=await createRuntime({vars:{RER_INSTALLATION_ID:'delegation-browser-installation'}});browser=await launchBrowser();shot=await evidence('delegation')})
after(async()=>{await browser?.close();await runtime?.close(passed)})
const recorded=work=>async()=>{try{await work({runtime,browser,shot})}catch(error){passed=false;throw error}}

test('Connected applications at 1440 and 390: register in the shell, approve exactly the selected access, publish once into the native editor and public help, revoke; the consent page allows only its registered callback and bare, signed-out or uninstalled URLs are friendly',recorded(applicationsBrowserJourney))

test('Local computers at 1440 and 390: the Connect computer dialog, authorization decisions with their recorded outcome, and a provider failure shown with its real status and redacted reason, attempted once, with nothing to send or retry',recorded(computersBrowserJourney))

test('at 1440 and 1280 a paired connector resolves a visitor\'s request, and Use hands its reply and files to the composer only once history is ready; the person edits and Sends exactly once, and the visitor sees the same message live and after reload',recorded(context=>useBrowserJourney({...context,widths:[1440,1280]})))

test('at 390 and 1279 the same Use and Send journey in the compact sheet, where a late Use response, navigation away or revoked authority never inserts a draft, files or focus',recorded(context=>useBrowserJourney({...context,widths:[390,1279]})))

import {timeAuthorityBrowser} from '../helpers/delegation/time-authority-browser.mjs'
test('task time authority is explicitly granted by its named operator and expires without a reply in the native Delegate panel at 1440 and 390',recorded(timeAuthorityBrowser))
