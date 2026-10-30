import assert from 'node:assert/strict'
import {createRuntime} from '../emitted-runtime.mjs'
import {launchBrowser,auditPage,viewports,evidence} from '../../journeys/kit/browser.mjs'
import {openBrandRequest,answerAndReport} from './brand-support-browser.mjs'
import {widgetIdentityBrowser} from '../widget/identity-browser.mjs'

export async function brandsBrowser(){
 const runtime=await createRuntime({vars:{APP_ORIGIN:'http://127.0.0.1',PUBLIC_HELP_HOSTS:JSON.stringify({'alpha.localhost':'brand-alpha-help','beta.localhost':'brand-beta-help'})}})
 const origin=runtime.origin,browser=await launchBrowser(),shot=await evidence('brands'),errors=[]
 const context=await browser.newContext({viewport:viewports.desktop,acceptDownloads:true}),page=await context.newPage()
 page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
 let passed=false,visitor
 const req=async(path,body,token,method=body===undefined?'GET':'POST')=>{
  const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
  const data=await response.json();assert.ok(response.ok,`${method} ${path}: ${response.status}`);return data
 }
 try{
  const email='brands@example.test',password='synthetic-brand-owner-password'
  const initial=await req('/api/identity/bootstrap',{email,password,name:'Brand Alpha',allowedOrigin:origin})
  const owner=await req('/api/identity/login',{email,password})
  const beta=await req('/api/management/projects',{name:'Brand Beta',allowed_origin:origin},owner.token),brands=[]
  for(const [id,label,color] of [[initial.projectId,'Alpha','#2468aa'],[beta.id,'Beta','#7b315f']]){
   const scoped=await req('/api/identity/switch-project',{projectId:id},owner.token)
   await req(`/api/management/projects/${id}/settings`,{website:`https://${label.toLowerCase()}.example.test`,timezone:'UTC'},scoped.token,'PUT')
   await req(`/api/management/projects/${id}/availability`,{is_availability_schedule_enabled:false,is_presence_away_enabled:false},scoped.token,'PUT')
   await req(`/api/management/projects/${id}/email-settings`,{from_name:label+' Care',from_address:`support@${label.toLowerCase()}.example.test`,inbound_address:`inbound@${label.toLowerCase()}.example.test`,is_enabled:true},scoped.token,'PUT')
   await req(`/api/public-site/projects/${id}/alias`,{slug:`brand-${label.toLowerCase()}-help`},scoped.token,'PUT')
   await req(`/api/knowledge/${id}/articles`,{title:label+' public guide',slug:'guide',content:label+' help center content',is_published:true},scoped.token)
   const project=await req('/api/identity/projects/'+id,undefined,scoped.token)
   const brand={id,label,color,token:scoped.token,widgetKey:project.widget_key,greeting:`Welcome to ${label} Care`}
   await context.clearCookies();await context.addCookies([{name:'h2h_session',value:brand.token,url:origin}])
   await page.goto(`${origin}/projects/${id}/edit`)
   assert.equal(await page.getByLabel('Website',{exact:true}).inputValue(),`https://${label.toLowerCase()}.example.test`)
   await page.getByRole('button',{name:'Appearance',exact:true}).click()
   await page.getByText('Additional branding',{exact:true}).click()
   await page.getByLabel('Public brand name',{exact:true}).fill(label+' Care')
   await page.getByLabel('Welcome greeting',{exact:true}).fill(brand.greeting)
   await page.getByLabel('Workspace color hex',{exact:true}).fill(color)
   const mode=page.getByRole('button',{name:'Light',exact:true})
   await mode.focus();await page.keyboard.press('Space')
   await page.getByRole('button',{name:'Update',exact:true}).click()
   await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
   await page.reload();await page.getByRole('button',{name:'Appearance',exact:true}).click()
   assert.equal(await page.getByRole('button',{name:'Light',exact:true}).getAttribute('aria-pressed'),'true')
   await page.getByText('Additional branding',{exact:true}).click()
   assert.equal(await page.getByLabel('Public brand name',{exact:true}).inputValue(),label+' Care')
   assert.equal(await page.getByLabel('Welcome greeting',{exact:true}).inputValue(),brand.greeting)
   assert.equal(await page.getByLabel('Workspace color hex',{exact:true}).inputValue(),color)
   await page.goto(`${origin}/projects/${id}/widget-settings`)
   await page.getByRole('tab',{name:'Theme',exact:true}).click()
   await page.locator('#happytohelp').getByText(brand.greeting,{exact:true}).waitFor()
   await page.goto(`${origin}/projects/${id}/email-settings`)
   await page.getByRole('heading',{name:'Send Email',exact:true}).waitFor()
   assert.ok(await page.locator('input').evaluateAll((inputs,address)=>inputs.some(input=>input.value===address),`support@${label.toLowerCase()}.example.test`))
   if(label==='Alpha'){
    visitor=await openBrandRequest({browser,origin,brand})
    brand.ticket={id:visitor.session.conversationId}
    await answerAndReport({origin,brand,visitor,page,shot})
   }else{
    const customer=await req('/api/identity/widget/session',{widgetKey:project.widget_key,name:'Beta customer'})
    brand.ticket=await req('/api/conversations',{projectId:id},customer.token)
    await req(`/api/conversations/${brand.ticket.id}/messages`,{localId:'beta-opening',content:'Beta private support request',expectedRevision:0},customer.token)
   }
   brands.push(brand)
  }
  for(const brand of brands){
   await context.clearCookies();await context.addCookies([{name:'h2h_session',value:brand.token,url:origin}])
   await page.goto(`${origin}/projects/${brand.id}/conversations/${brand.ticket.id}`)
   await page.locator('.transcript-message-content').getByText(brand.label+' private support request',{exact:true}).waitFor()
   assert.equal(await page.locator('.transcript-message-content').getByText((brand.label==='Alpha'?'Beta':'Alpha')+' private support request',{exact:true}).count(),0)
   await auditPage(page,shot(brand.label+'-inbox.png'))
   await page.goto(`${origin}/projects/${brand.id}/reports`)
   await page.getByRole('heading',{name:'Reports',exact:true}).waitFor()
   if(brand.label==='Beta')assert.equal(await page.getByText('Alpha resolved my question',{exact:true}).count(),0)
   const host=new URL(origin);host.hostname=brand.label.toLowerCase()+'.localhost'
   await page.goto(host.href)
   await page.getByText(brand.label+' public guide',{exact:true}).click()
   await page.getByText(brand.label+' help center content',{exact:true}).waitFor()
   assert.equal(await page.getByText((brand.label==='Alpha'?'Beta':'Alpha')+' public guide',{exact:true}).count(),0)
   await auditPage(page,shot(brand.label+'-help.png'))
  }
  const selected=brands.map(b=>b.id).join(',')
  const config=await req(`/api/management/projects/${brands[0].id}/brands?projects=${selected}`,undefined,brands[0].token)
  assert.deepEqual(config.data.brands.map(b=>b.helpHosts),[['alpha.localhost'],['beta.localhost']])
  const report=await req(`/api/management/projects/${brands[0].id}/brands/reports?projects=${selected}&period=7`,undefined,brands[0].token)
  assert.equal(report.data.aggregate.volume,2)
  assert.deepEqual(errors,[])
  await widgetIdentityBrowser({browser,shot})
  passed=true
 }finally{await visitor?.context.close();await browser.close();await runtime.close(passed)}
}
