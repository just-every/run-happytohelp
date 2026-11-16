// Run Edit Run fleet, 2026-11-16. Actual local public-door probe; private entry values stay out of receipts.
import {launchBrowser} from '/home/agent/rer-consolidation/work/hh-stranger11-followups-1/repo/tests/journeys/kit/browser.mjs'
import {writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
async function publishedDocumentationAttribution(){
const head=execFileSync('git',['-C','/home/agent/rer-consolidation/work/hh-stranger11-followups-1/repo','rev-parse','HEAD'],{encoding:'utf8'}).trim()
const stage=process.argv[2]||'before',browser=await launchBrowser(),receipt=[]
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}})
 for(const slug of ['request-forms','macros-and-teamwork']){
  await page.goto('http://127.0.0.1:3097/docs/'+slug,{waitUntil:'networkidle',timeout:90000})
  const text=await page.locator('main').innerText()
  const signatures=text.split('\n').filter(line=>/clarification: Run Edit Run fleet/.test(line))
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:width===390?844:900})
   await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight))
   await page.waitForTimeout(250)
   await page.screenshot({path:'/home/agent/rer-consolidation/work/hh-stranger11-followups-1/packet/'+stage+'-docs-'+slug+'-'+width+'.png'})
  }
  receipt.push({head,page:'/docs/'+slug,internalSignatureCount:signatures.length,signatures})
 }
 await writeFile('/home/agent/rer-consolidation/work/hh-stranger11-followups-1/packet/'+stage+'-docs.json',JSON.stringify(receipt,null,2)+'\n')
 console.log(JSON.stringify(receipt))
}finally{await browser.close()}

}
await publishedDocumentationAttribution()
