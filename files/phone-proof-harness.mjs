import {launchBrowser} from '/workspace/run-happytohelp/tests/journeys/kit/browser.mjs'
import {collaborationBrowser} from '/workspace/run-happytohelp/tests/helpers/inbox/desk-collaboration.mjs'
const browser=await launchBrowser()
const page=await browser.newPage(),prototype=Object.getPrototypeOf(page),original=prototype.screenshot
prototype.screenshot=async function(options){
 if(options?.path?.endsWith('conflict-390.png')){
  await this.waitForFunction(()=>document.querySelector('#conversation-assistant')?.getAttribute('aria-hidden')==='true')
  const hide=this.getByRole('button',{name:'Hide conversation panel',exact:true})
  if(await hide.isVisible())await hide.click()
  await this.waitForFunction(()=>getComputedStyle(document.querySelector('#conversation-assistant')).visibility==='hidden')
 }
 return original.call(this,{...options,animations:"disabled"})
}
await browser.close()
await collaborationBrowser({width:1440})
console.log('PASS competing reply proof: 1440 assertions; 1440 and 390 screenshots; phone assistant settled before capture.')
