import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createRuntime} from '../emitted-runtime.mjs'
import {launchBrowser} from '../../journeys/kit/browser.mjs'

/** Existing native configuration screens are the brand configuration doors. */
export async function brandsBrowser(){
 const directory=resolve(process.env.H2H_EVIDENCE_DIR||'test-results','brands');await mkdir(directory,{recursive:true})
 const runtime=await createRuntime(),origin=runtime.origin,errors=[],records=[];let browser,passed=false
 try{
  const req=async(path,body,token,method=body===undefined?'GET':'POST')=>{
   const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
   const data=await response.json();assert.ok(response.ok,`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);return data
  }
  const email='brands@example.test',password='synthetic-happytohelp-3'
  const initial=await req('/api/identity/bootstrap',{email,password,name:'Brand Alpha',allowedOrigin:origin})
  const owner=await req('/api/identity/login',{email,password})
  const beta=await req('/api/management/projects',{name:'Brand Beta',allowed_origin:origin},owner.token)
  const brands=[]
  for(const [id,label,color] of [[initial.projectId,'Alpha','#2468aa'],[beta.id,'Beta','#7b315f']]){
   const scoped=await req('/api/identity/switch-project',{projectId:id},owner.token)
   await req(`/api/management/projects/${id}/settings`,{website:`https://${label.toLowerCase()}.example.test`,brand_name:label+' Care',help_center_domain:`https://help.${label.toLowerCase()}.example.test`,primary_color:color,timezone:'UTC'},scoped.token,'PUT')
   await req(`/api/management/projects/${id}/availability`,{is_availability_schedule_enabled:false,is_presence_away_enabled:false},scoped.token,'PUT')
   await req(`/api/management/projects/${id}/email-settings`,{from_name:label+' Care',from_address:`support@${label.toLowerCase()}.example.test`,inbound_address:`inbound@${label.toLowerCase()}.example.test`,is_enabled:true},scoped.token,'PUT')
   const project=await req('/api/identity/projects/'+id,undefined,scoped.token)
   const visitor=await req('/api/identity/widget/session',{widgetKey:project.widget_key,name:label+' customer'},undefined)
   const ticket=await req('/api/conversations',{projectId:id},visitor.token)
   await req(`/api/conversations/${ticket.id}/messages`,{localId:'synthetic-happytohelp-4',content:label+' private support request',expectedRevision:0},visitor.token)
   brands.push({id,label,color,token:scoped.token,ticket})
  }
  browser=await launchBrowser()
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:width===390?844:1000}}),page=await context.newPage();page.setDefaultTimeout(20000)
   page.on('pageerror',error=>errors.push(error.message))
   try{
    for(const brand of brands){
     await context.clearCookies();await context.addCookies([{name:'h2h_session',value:brand.token,url:origin}])
     await page.goto(`${origin}/projects/${brand.id}/edit`)
     await page.getByLabel('Website',{exact:true}).waitFor();assert.equal(await page.getByLabel('Website',{exact:true}).inputValue(),`https://${brand.label.toLowerCase()}.example.test`)
     await page.screenshot({path:`${directory}/${brand.label.toLowerCase()}-settings-${width}.png`,fullPage:true})
     await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByText('Additional branding',{exact:true}).click()
     assert.equal(await page.getByLabel('Public brand name',{exact:true}).inputValue(),brand.label+' Care')
     assert.equal(await page.getByLabel('Workspace color hex').inputValue(),brand.color)
     await page.screenshot({path:`${directory}/${brand.label.toLowerCase()}-identity-${width}.png`,fullPage:true})
     await page.goto(`${origin}/projects/${brand.id}/email-settings`);await page.getByRole('heading',{name:'Send Email',exact:true}).waitFor()
     assert.ok(await page.locator('input').evaluateAll((inputs,address)=>inputs.some(input=>input.value===address),`support@${brand.label.toLowerCase()}.example.test`))
     await page.screenshot({path:`${directory}/${brand.label.toLowerCase()}-sender-${width}.png`,fullPage:true})
     await page.goto(`${origin}/projects/${brand.id}/conversations/${brand.ticket.id}`)
     await page.locator('.transcript-message-content').getByText(brand.label+' private support request',{exact:true}).waitFor()
     assert.equal(await page.locator('.transcript-message-content').getByText((brand.label==='Alpha'?'Beta':'Alpha')+' private support request',{exact:true}).count(),0)
     await page.screenshot({path:`${directory}/${brand.label.toLowerCase()}-inbox-${width}.png`,fullPage:true})
     await page.goto(`${origin}/projects/${brand.id}/reports`);await page.getByRole('heading',{name:'Reports',exact:true}).waitFor()
     await page.screenshot({path:`${directory}/${brand.label.toLowerCase()}-reports-${width}.png`,fullPage:true})
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'brand screens fit the viewport')
     records.push({width,brand:brand.label,screens:['settings','identity','sender','inbox','reports']})
    }
    const selected=brands.map(b=>b.id).join(',')
    const config=await req(`/api/management/projects/${brands[0].id}/brands?projects=${selected}`,undefined,brands[0].token)
    assert.equal(config.data.brands.length,2);assert.match(config.data.explanation,/never copied/)
    const report=await req(`/api/management/projects/${brands[0].id}/brands/reports?projects=${selected}&period=7`,undefined,brands[0].token)
    assert.equal(report.data.aggregate.volume,2)
   }finally{await context.close()}
  }
  assert.deepEqual(errors,[]);passed=true
  await writeFile(`${directory}/checks.json`,JSON.stringify({records,checks:['separate domains and public identities','separate senders','isolated native inboxes','per-brand and explicit aggregate reports','responsive screens'],pageErrors:errors},null,2))
 }finally{await browser?.close();await runtime.close(passed)}
}
