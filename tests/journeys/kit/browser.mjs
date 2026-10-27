import {mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {chromium} from 'playwright'

// Headless Chromium with the default arguments plus a mock keychain, so a local run never touches the login keychain.
const chromiumPath=process.env.H2H_CHROMIUM_PATH||process.env.H2H_CHROMIUM_EXECUTABLE_PATH
export const launchBrowser=()=>chromium.launch({headless:true,...(chromiumPath?{executablePath:chromiumPath}:{}),args:['--use-mock-keychain','--password-store=basic',...(chromiumPath?['--no-sandbox']:[])]})
export const viewports={desktop:{width:1440,height:900},mobile:{width:390,height:844}}
// Screenshots and receipts go to the CI evidence directory, or test-results locally.
export async function evidence(name){const directory=resolve(process.env.H2H_EVIDENCE_DIR||'test-results',name);await mkdir(directory,{recursive:true});return file=>join(directory,file)}
