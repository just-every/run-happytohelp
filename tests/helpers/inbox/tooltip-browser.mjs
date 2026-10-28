import assert from 'node:assert/strict'
import {createRuntime} from '../emitted-runtime.mjs'
import {buildInboxFixture} from '../inbox-conversation-fixture.mjs'
import {launchBrowser} from '../../journeys/kit/browser.mjs'

// An icon-only control's tooltip (H19, src/modules/tooltip): the list head's New ticket, reached by the keyboard, shows its
// tooltip at once, worded as the control's own accessible name, and hidden from assistive technology so the name is read
// once; Escape hides it.
export async function tooltipBrowser(){
 const runtime=await createRuntime({vars:{H2H_LOCAL:'true',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test'}})
 const browser=await launchBrowser(),problems=[]
 let success=false
 try{
  const fx=await buildInboxFixture(runtime.origin)
  const login=await fetch(runtime.origin+'/api/identity/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:fx.owner.email,password:fx.owner.password})})
  assert.ok(login.ok,`sign-in: ${login.status}`)
  const {token}=await login.json()
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:width===390?844:900}})
   await context.addCookies([{name:'h2h_session',value:token,url:runtime.origin}])
   const page=await context.newPage();page.setDefaultTimeout(15000)
   page.on('pageerror',error=>problems.push(`${width}: ${error.message}`))
   await page.goto(`${runtime.origin}/projects/${fx.projectId}/conversations`)
   const control=page.getByRole('button',{name:'New ticket',exact:true})
   await control.waitFor()
   // Time the tooltip from the focus that reaches the control.
   await page.evaluate(()=>{const tip=document.querySelector('.ui-tooltip');window.__tooltipOpened=null;document.addEventListener('focusin',()=>{window.__focusedAt=performance.now()},{capture:true,once:true});new MutationObserver(()=>{if(tip.hasAttribute('data-open')&&window.__tooltipOpened===null)window.__tooltipOpened=performance.now()-window.__focusedAt}).observe(tip,{attributes:true,attributeFilter:['data-open']})})
   await page.locator('.conversation-inbox input[type=search]').first().focus()
   await page.keyboard.press('Shift+Tab')
   assert.equal(await control.evaluate(element=>element===document.activeElement),true,`${width}: Shift+Tab from the search reaches New ticket`)
   const tip=page.locator('.ui-tooltip[data-open]')
   await tip.waitFor()
   assert.equal(await tip.textContent(),'New ticket',`${width}: the tooltip reads the control's accessible name`)
   const opened=await page.evaluate(()=>window.__tooltipOpened)
   assert.ok(opened!==null&&opened<100,`${width}: keyboard focus shows the tooltip at once (${opened} ms)`)
   assert.deepEqual(await page.evaluate(()=>{const tip=document.querySelector('.ui-tooltip'),control=document.activeElement;return {hidden:tip.getAttribute('aria-hidden'),topLayer:tip.matches(':popover-open'),title:control.getAttribute('title'),describedBy:control.getAttribute('aria-describedby')}}),{hidden:'true',topLayer:true,title:null,describedBy:null},`${width}: the name is read once: the tooltip is hidden from assistive technology and the control has no title`)
   const box=await tip.boundingBox(),viewport=page.viewportSize()
   assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height,`${width}: the tooltip sits inside the viewport: ${JSON.stringify(box)}`)
   await page.keyboard.press('Escape')
   await tip.waitFor({state:'hidden'})
   await context.close()
  }
  assert.deepEqual(problems,[])
  success=true
 }finally{await browser.close();await runtime.close(success)}
}
