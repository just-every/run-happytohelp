import {mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {chromium} from 'playwright'

// Headless Chromium with the default arguments plus a mock keychain, so a local run never touches the login keychain.
export const launchBrowser=()=>chromium.launch({headless:true,...(process.env.H2H_CHROMIUM_PATH?{executablePath:process.env.H2H_CHROMIUM_PATH}:{}),args:['--use-mock-keychain','--password-store=basic',...(process.env.H2H_CHROMIUM_PATH?['--no-sandbox']:[])]})
export const viewports={desktop:{width:1440,height:900},mobile:{width:390,height:844}}
// Screenshots and receipts go to the CI evidence directory, or test-results locally.
export async function evidence(name){const directory=resolve(process.env.H2H_EVIDENCE_DIR||'test-results',name);await mkdir(directory,{recursive:true});return file=>join(directory,file)}
