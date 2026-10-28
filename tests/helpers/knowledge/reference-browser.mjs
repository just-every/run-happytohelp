import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {createRuntime} from '../emitted-runtime.mjs'
import {launchBrowser} from '../../journeys/kit/browser.mjs'

export async function referenceBrowser(){
 const evidence=join(process.env.H2H_EVIDENCE_DIR?resolve(process.env.H2H_EVIDENCE_DIR):tmpdir(),'knowledge-references');await mkdir(evidence,{recursive:true})
 const runtime=await createRuntime({vars:{H2H_LOCAL:'true',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test'}}),browser=await launchBrowser();let success=false
 try{
  const call=async(path,body,token,method=body===undefined?'GET':'POST')=>{const response=await fetch(runtime.origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.ok(response.ok,`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);return data}
  const password='synthetic-knowledge-browser-2026',email='elise@aster.example.test',setup=await call('/api/identity/bootstrap',{password,name:'Aster Support',email,allowedOrigin:runtime.origin}),p=setup.projectId,owner=await call('/api/identity/login',{email,password}),token=owner.token
  const widget=await call(`/api/management/projects/${p}/widget-settings`,undefined,token)
  const customer=async(name,email)=>{const identity=await call('/api/identity/widget/session',{widgetKey:widget.widgetKey,identifier:email,email,name,contact_hash:createHmac('sha256',widget.verificationSecret).update(email).digest('hex')});const conversation=await call('/api/conversations',{projectId:p},identity.token);await call(`/api/conversations/${conversation.id}/messages`,{localId:crypto.randomUUID(),content:'Please help me recover access to my team account.',expectedRevision:0},identity.token);return {...identity,conversation}}
  const a=await customer('Alice Morgan','alice@northstar.example.test'),c=await customer('Jamie Chen','jamie@harbor.example.test')
  const category=(await call(`/api/knowledge/${p}/categories`,{title:'Account recovery',audience:'selected',allowedDomains:['northstar.example.test']},token)).id
  const company=(await call(`/api/management/projects/${p}/companies`,{name:'Northstar Studio',domains:['northstar.example.test'],attributes:{}},token)).company
  const body='Keep the amber recovery certificate inside the sealed support envelope until the account coordinator completes the identity inspection and confirms the protected restoration request.'
  const article=(await call(`/api/knowledge/${p}/articles`,{title:'Recover a team account',slug:'recover-team',summary:'Secure recovery for approved customer accounts.',content:body,categoryIds:[category],status:'published'},token)).id
  const grant=ids=>call(`/api/knowledge/${p}/categories/${category}/entitlements`,{required:true,contactIds:ids,companyIds:[]},token,'PUT')
  await grant([a.contactId])
  const errors=[]
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:width===390?844:1000}});await context.addCookies([{name:'h2h_session',value:token,url:runtime.origin}]);const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message))
   const screen=async name=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} ${name}: no horizontal overflow`);await page.screenshot({path:join(evidence,`${width}-${name}.png`),fullPage:true})}
   const ticket=async customer=>{await page.goto(`${runtime.origin}/projects/${p}/conversations/${customer.conversation.id}`);await page.getByRole('textbox',{name:'Reply to conversation'}).first().waitFor()}
   const tools=async item=>{await page.locator('#conversation-composer-tools').click();await page.getByRole('menuitem',{name:item,exact:true}).click()}
   await page.goto(`${runtime.origin}/projects/${p}/articles`);await page.getByRole('searchbox',{name:'Search articles'}).waitFor();await screen('operator-articles')
   await page.getByRole('button',{name:'Help Center settings',exact:true}).click();await page.locator('.knowledge-experience').waitFor();await screen('help-center-settings')
   await page.getByRole('button',{name:'Article analytics',exact:true}).click();await page.getByText('Tickets from article request links',{exact:true}).first().waitFor();await screen('article-analytics')
   await page.goto(`${runtime.origin}/projects/${p}/categories/${category}`);await page.getByLabel('Who can read this collection?').waitFor();await page.locator('#collection-customer-search').waitFor();await screen('collection-grants')
   await page.locator('#collection-customer-search').fill('Northstar');await page.getByRole('button',{name:'Add Northstar Studio',exact:true}).waitFor();await screen('collection-company-search')
   await page.goto(`${runtime.origin}/projects/${p}/macros/create`);await page.getByLabel('Title',{exact:true}).fill(`Team recovery ${width}`);await page.getByRole('button',{name:'Insert article',exact:true}).click();await page.getByLabel('Article',{exact:true}).selectOption(article);await screen('saved-reply-insert')
   await page.getByRole('button',{name:'Insert text',exact:true}).click();await page.getByRole('article',{name:'Knowledge reference'}).waitFor();await screen('saved-reply-reference')
   await page.getByRole('button',{name:'Create',exact:true}).click();await page.waitForURL(url=>url.pathname.includes('/macros/')&&!url.pathname.endsWith('/create'));const savedMacroId=new URL(page.url()).pathname.split('/').pop();await page.locator('summary').filter({hasText:`Team recovery ${width}`}).waitFor();await page.locator('summary').filter({hasText:`Team recovery ${width}`}).click();await screen('saved-reply-history')
   await ticket(a);await tools('Help articles');await page.getByRole('button',{name:'Insert text',exact:true}).waitFor();await screen('ticket-picker')
   await page.getByRole('button',{name:'Insert text',exact:true}).click();await page.getByRole('article',{name:'Knowledge reference'}).last().waitFor();await page.waitForFunction(()=>!document.querySelector('.knowledge-reference-editor [aria-busy="true"]'));await screen('composer-reference')
   for(const button of await page.locator('.knowledge-reference-card button').all()){const box=await button.boundingBox();assert.ok(box&&box.width>=44&&box.height>=44,'reference controls have a usable target')}
   const reply=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/conversations/${a.conversation.id}/messages`);await page.getByRole('button',{name:'Send',exact:true}).click();assert.equal((await reply).status(),200)
   await grant([]);await page.reload();await page.locator('.knowledge-reference-list').first().waitFor();await screen('operator-thread-withheld');await grant([a.contactId])
   await ticket(c);await tools('Help articles');await page.getByLabel('Show internal articles').check();await page.locator('.article-picker').getByText('Recover a team account',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Insert text',exact:true}).isDisabled(),true);await screen('picker-blocked-recipient')
   await tools('Back to reply');await tools('Saved replies');await page.getByRole('link',{name:`Team recovery ${width}`,exact:true}).click();await page.getByRole('region',{name:'Macro preview'}).waitFor();await screen('saved-reply-target-preview')
   await page.goto(`${runtime.origin}/projects/${p}/conversations?view=open`);await page.getByRole('button',{name:'Select tickets',exact:true}).click();await page.getByRole('button',{name:'Select loaded tickets',exact:true}).click();await page.getByLabel('Macro',{exact:true}).selectOption(savedMacroId);await page.getByRole('button',{name:'Preview all tickets',exact:true}).click();await page.getByRole('button',{name:'Apply reviewed macro',exact:true}).waitFor();for(const summary of await page.locator('summary').filter({hasText:'Every change'}).all())await summary.click();await screen('bulk-saved-reply-preview');await page.getByText('Withheld from Jamie Chen',{exact:true}).last().scrollIntoViewIfNeeded();await screen('bulk-reference-visibility')
   const bulkApplied=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith(`/macros/${savedMacroId}/apply`));await page.getByRole('button',{name:'Apply reviewed macro',exact:true}).click();assert.equal((await bulkApplied).status(),200);await ticket(c);await page.getByRole('article',{name:'Knowledge reference'}).last().waitFor();await page.waitForFunction(()=>!document.querySelector('.knowledge-reference-editor [aria-busy="true"]'));await screen('bulk-saved-reply-draft')
   await page.goto(`${runtime.origin}/help/${p}/recover-team`);assert.equal((await page.request.get(`${runtime.origin}/help/${p}/recover-team`)).status(),404);await screen('help-private-miss')
   const help=await browser.newContext({viewport:{width,height:width===390?844:1000}});await help.addCookies([{name:'h2h_session',value:a.token,url:runtime.origin}]);const customerPage=await help.newPage();await customerPage.goto(`${runtime.origin}/help/${p}/recover-team`);await customerPage.getByRole('heading',{name:'Recover a team account',exact:true}).waitFor();await customerPage.screenshot({path:join(evidence,`${width}-help-authorized.png`),fullPage:true});await help.close()
   await context.close()
  }
  assert.deepEqual(errors,[]);success=true
 }catch(error){for(const [ci,context] of browser.contexts().entries())for(const [pi,page] of context.pages().entries())await page.screenshot({path:join(evidence,`failure-${ci}-${pi}.png`),fullPage:true}).catch(()=>{});throw error}finally{await browser.close();await runtime.close(success)}
}
