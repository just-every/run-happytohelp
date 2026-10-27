import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRuntime} from './emitted-runtime.mjs'
import {launchBrowser,evidence} from '../journeys/kit/browser.mjs'

// Reuse the ticket browser registration. Only DNS and mail delivery are network fakes.
export async function accountLookupBrowser(){
 const scratch=await mkdtemp(join(tmpdir(),'hh-account-edge-')),mail=join(scratch,'mail.jsonl'),edge=join(scratch,'edge.mjs')
 await writeFile(mail,'')
 await writeFile(edge,`import {appendFileSync} from 'node:fs';export default async request=>{if(request.url==='https://api.resend.com/emails'){appendFileSync(${JSON.stringify(mail)},JSON.stringify(await request.json())+'\\n');return Response.json({id:crypto.randomUUID()})}if(request.url.startsWith('https://cloudflare-dns.com/'))return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.com.'}]});throw Error('Unexpected network edge')}`)
 const origin='http://127.0.0.1:18847',runtime=await createRuntime({port:18847,outboundFixture:edge,vars:{APP_ORIGIN:origin,EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-hh-1',EMAIL_FROM:'support@example.com'}}),browser=await launchBrowser(),shot=await evidence('account-lookup')
 let success=false
 try{
  const owner={email:'synthetic-hh-owner@example.test',password:'synthetic-hh-owner-password',ownerName:'Alex Rivers',name:'Northstar Support'},request=async(path,body,token,method=body===undefined?'GET':'POST')=>{
   const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)})
   const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result
  }
  const {projectId:p}=await request('/api/identity/bootstrap',{...owner,allowedOrigin:origin}),login=await request('/api/identity/login',owner),base=`/api/management/projects/${p}`,api=(path,body,method)=>request(path,body,login.token,method)
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(15000)
  const measure=async(page,name,width)=>{
   const controls=await page.locator('input:not([type=hidden]),select,textarea,button,a[href],[tabindex="0"]').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length).map(node=>{const r=node.getBoundingClientRect(),label=node.labels?.[0],target=label?label.getBoundingClientRect():r;return {name:node.getAttribute('aria-label')||label?.textContent?.trim()||node.textContent?.trim()||node.id||node.tagName,width:r.width,height:r.height,alignment:label?Math.abs(r.y+r.height/2-target.y-target.height/2):null,targetWidth:Math.max(r.width,target.width),targetHeight:Math.max(r.height,target.height),disabled:node.disabled||false}}));
   await writeFile(shot(`${name}-${width}-controls.json`),JSON.stringify(controls,null,2));
  };
  const capture=async name=>{for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:1000});if(name==='08-macro-account-choice')await page.getByLabel('Support account',{exact:true}).scrollIntoViewIfNeeded();if(name==='09-macro-account-preview')await page.getByRole('region',{name:'Macro preview',exact:true}).scrollIntoViewIfNeeded();if(['05-ticket-value','06-ticket-history'].includes(name)){if(await page.locator('#conversation-assistant').getAttribute('aria-hidden')==='true')await page.getByRole('button',{name:'Show conversation panel',exact:true}).click();await page.getByRole('tab',{name:'Ticket',exact:true}).click();await (name==='05-ticket-value'?page.getByLabel('Support account',{exact:true}):page.locator('.ticket-history')).scrollIntoViewIfNeeded();}if(width===390&&name==='01-configure-account'){const targets=await page.locator('.ticket-settings-form label.form-check').evaluateAll(nodes=>nodes.map(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})));assert.ok(targets.length>0&&targets.every(target=>target.width>=44&&target.height>=44),'phone permission targets are at least 44 px');const alignment=await page.getByLabel('Required',{exact:true}).evaluate(node=>{const a=node.getBoundingClientRect(),b=node.labels[0].getBoundingClientRect();return Math.abs(a.y+a.height/2-b.y-b.height/2)});assert.ok(alignment<1,`Required alignment ${alignment}`);console.log('Required switch center delta:',alignment);console.log('Phone role targets:',JSON.stringify(targets));}if(name==='02-configure-form'){const control=page.getByRole('button',{name:'Move down',exact:true}).first();await control.scrollIntoViewIfNeeded();await page.mouse.move(1,1);await control.hover();await page.waitForTimeout(350);if(width===390)console.log('Phone move-control target:',await control.evaluate(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})))}else await page.waitForTimeout(350);await measure(page,name,width);await page.screenshot({path:shot(`${name}-${width}.png`),fullPage:true});}await page.setViewportSize({width:1440,height:1000})}
  await page.goto(origin+`/login?returnTo=/projects/${p}/ticket-settings`);await page.getByLabel('Email',{exact:true}).fill(owner.email);await page.getByLabel('Password',{exact:true}).fill(owner.password);await page.getByRole('button',{name:'Login',exact:true}).click()
  await page.getByRole('button',{name:'Fields',exact:true}).click();await page.getByRole('button',{name:'New field',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Support account');await page.getByLabel('Type',{exact:true}).selectOption('account');for(const group of ['Roles that can read this field','Roles that can edit this field']){const checks=page.getByRole('group',{name:group,exact:true}).getByRole('checkbox');for(const check of await checks.all())await check.uncheck()}await capture('01-configure-account');await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
  const field=(await api(base+'/ticket-fields')).data.find(field=>field.name==='Support account');assert.equal(field.type,'account')
  const company=(await api(base+'/companies',{name:'Northstar account',portalCompanyView:false})).company
  const secondary=(await api(base+'/companies',{name:'Harbor account',portalCompanyView:false})).company
  const detail=(await api(base+'/ticket-fields',{name:'Request detail',type:'text'})).data
  await api(`/api/forms/projects/${p}/forms`,{title:'Other help',enabled:true,fields:[]});
  const form=(await api(`/api/forms/projects/${p}/forms`,{title:'Account help',enabled:true,fields:[{fieldId:detail.id}]})).data
  await page.goto(origin+`/projects/${p}/edit?tab=forms`);await page.getByRole('button',{name:'Edit Account help',exact:true}).click();await page.getByRole('heading',{name:'Account help',exact:true}).waitFor();await page.getByLabel('Add ticket field',{exact:true}).selectOption(field.id);await page.getByRole('button',{name:'Add field',exact:true}).click();await page.getByLabel('Require Support account',{exact:true}).check();const move=page.getByRole('button',{name:'Move down',exact:true}).first();await move.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await page.locator('[role=tooltip]').filter({hasText:'Move down'}).waitFor();await capture('02-configure-form');
  await page.getByRole('button',{name:'Move up',exact:true}).nth(1).click();
  await page.getByLabel('Show only when a condition matches',{exact:true}).check();
  const condition=page.getByLabel('Condition value',{exact:true});
  assert.equal(await condition.inputValue(),'','new account conditions start unset');
  await condition.selectOption(company.id);
  await page.getByLabel('Condition operator',{exact:true}).selectOption('present');
  await page.getByLabel('Condition operator',{exact:true}).selectOption('equals');
  assert.equal(await condition.inputValue(),'','changing an account operator never chooses an account');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();
  assert.equal((await api(`/api/forms/projects/${p}/forms/${form.id}`)).data.fields.find(ref=>ref.fieldId===detail.id).condition.value,'');
  await page.reload();await page.getByRole('button',{name:'Edit Account help',exact:true}).click();
  assert.equal(await condition.inputValue(),'','saved empty account conditions reload unset');
  await condition.selectOption({label:'Northstar account'});assert.equal(await condition.inputValue(),company.id);
  await page.setViewportSize({width:390,height:844});
  for(const name of ['Require Support account','Require Request detail']){const pill=await page.getByLabel(name,{exact:true}).boundingBox();assert.ok(pill.width>pill.height,'phone switches retain their pill shape');const rect=await page.getByLabel(name,{exact:true}).evaluate(node=>{const r=node.labels[0].getBoundingClientRect();return {width:r.width,height:r.height}});assert.ok(rect.width>=44&&rect.height>=44,`${name} target: ${JSON.stringify(rect)}`)}
  await page.setViewportSize({width:1440,height:1000});await capture('02b-account-condition');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
  const customer='synthetic-hh-customer@example.com'
  await request(`/api/portal/${p}/access/request`,{email:customer,returnTo:`/help/${p}/requests/${form.id}`})
  const delivered=(await readFile(mail,'utf8')).trim().split('\n').map(JSON.parse).find(item=>[].concat(item.to).includes(customer));assert.ok(delivered)
  const link=delivered.text.match(/http:\/\/127\.0\.0\.1:18847\/api\/portal\/\S+/)[0],customerContext=await browser.newContext({viewport:{width:1440,height:1000}})
  const customerPage=await customerContext.newPage(),offerInputs=[];
  customerPage.on('request',request=>{const url=new URL(request.url());if(url.pathname===`/api/forms/${p}/${form.id}`&&url.searchParams.has('fields'))offerInputs.push(JSON.parse(url.searchParams.get('fields')))});
  const assertPrivate=async forbidden=>{
   for(const path of [`/api/forms/${p}`,`/api/forms/${p}/${form.id}`,`/help/${p}/requests/${form.id}`]){
    const response=await customerContext.request.get(origin+path),raw=await response.text();assert.equal(response.status(),200)
    for(const secret of forbidden)assert.ok(!raw.includes(secret),'raw browser response excludes unavailable account data')
   }
  }
  await assertPrivate([company.id,company.name,secondary.id,secondary.name]);await customerPage.goto(origin+`/help/${p}/requests/${form.id}`);
  const customerCapture=async name=>{for(const width of [1440,390]){await customerPage.setViewportSize({width,height:width===390?844:1000});await measure(customerPage,name,width);await customerPage.screenshot({path:shot(`${name}-${width}.png`),fullPage:true})}await customerPage.setViewportSize({width:1440,height:1000})};
  await customerPage.getByText('Verify your email to see your accounts.',{exact:false}).waitFor();await customerCapture('03a-anonymous');
  await customerPage.getByLabel('Subject',{exact:false}).fill('Account access question');
  const verification=await customerContext.newPage();await verification.goto(link);await verification.close();await customerPage.bringToFront();await customerPage.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await customerPage.getByText('No accounts are available for your verified email.',{exact:false}).waitFor();assert.equal(await customerPage.getByLabel('Subject',{exact:false}).inputValue(),'Account access question');await customerCapture('03b-no-eligible-account');await assertPrivate([company.id,company.name,secondary.id,secondary.name]);
  const contact=(await api(base+'/contacts?search='+encodeURIComponent(customer))).data.find(row=>row.email===customer)
  assert.ok(contact)
  await api(base+`/companies/${company.id}/members/${contact.id}`,{},'PUT')
  await customerPage.evaluate(()=>window.dispatchEvent(new Event('focus')));await customerPage.getByLabel('Support account',{exact:false}).locator('option').filter({hasText:'Northstar account'}).waitFor({state:'attached'});await customerPage.getByLabel('Subject',{exact:false}).fill('Account access question');await customerPage.getByLabel('Message',{exact:false}).fill('Please help with my account.');await customerPage.getByLabel('Support account',{exact:false}).selectOption(company.id)
  await customerPage.reload();await customerPage.getByLabel('Request detail',{exact:false}).waitFor({state:'visible'});assert.equal(await customerPage.getByLabel('Support account',{exact:false}).inputValue(),company.id,'restored account drafts refresh dependent visibility immediately');
  await assertPrivate([secondary.id,secondary.name]);
  await customerPage.getByLabel('Request detail',{exact:false}).fill('Draft account detail.');
  await api(base+`/companies/${company.id}/members/${contact.id}`,undefined,'DELETE')
  await assertPrivate([company.id,company.name,secondary.id,secondary.name]);
  await customerPage.getByRole('button',{name:'Submit request',exact:true}).focus();await customerPage.keyboard.press('Enter');await customerPage.locator('.request-field-error').filter({hasText:'Choose an available account'}).waitFor();assert.equal(await customerPage.getByLabel('Support account',{exact:false}).getAttribute('aria-invalid'),'true')
  assert.equal(await customerPage.getByLabel('Support account',{exact:false}).inputValue(),'');await customerCapture('03-refused-account');await customerPage.waitForFunction(()=>{const select=document.querySelector('[aria-invalid="true"]');return select?.tagName==='SELECT'&&select.options.length===1});assert.equal(await customerPage.getByLabel('Support account',{exact:false}).isEnabled(),true,'a refused account remains available to keyboard users after refreshing empty choices');assert.equal(await customerPage.getByLabel('Support account',{exact:false}).evaluate(node=>document.activeElement===node),true,'focus stays on the refused account after the offer refresh');await api(base+`/companies/${company.id}/members/${contact.id}`,{},'PUT');await customerPage.evaluate(()=>window.dispatchEvent(new Event('focus')));await customerPage.getByLabel('Support account',{exact:false}).selectOption(company.id);await customerPage.getByLabel('Request detail',{exact:false}).fill('Please restore access.');await customerPage.getByRole('button',{name:'Submit request',exact:true}).click();await customerPage.getByRole('link',{name:'View your request',exact:true}).waitFor();await customerCapture('04-submitted')
  const ticketId=(await customerPage.getByRole('link',{name:'View your request'}).getAttribute('href')).split('/').at(-1)
  assert.equal((await api(`/api/dashboard/projects/${p}/conversations/${ticketId}/ticket`)).data.fields[detail.id],'Please restore access.','account submissions retain ordinary typed answers');
  await page.goto(origin+`/projects/${p}/conversations/${ticketId}`);await page.getByRole('tab',{name:'Ticket',exact:true}).click();await page.locator('#ticket-section-fields-heading').click();await page.getByLabel('Support account',{exact:true}).waitFor();assert.equal(await page.getByLabel('Support account',{exact:true}).inputValue(),company.id);await page.getByLabel('Support account',{exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.getByLabel('Support account',{exact:true}).locator('option:checked').textContent(),'Northstar account');await capture('05-ticket-value');
  await api(base+`/companies/${secondary.id}/members/${contact.id}`,{},'PUT');await page.getByLabel('Support account',{exact:true}).selectOption({label:'Harbor account'});await page.getByRole('button',{name:'Save ticket',exact:true}).click();await page.getByText('Ticket saved.',{exact:true}).waitFor();assert.equal((await api(`/api/dashboard/projects/${p}/conversations/${ticketId}/ticket`)).data.fields[field.id],secondary.id);
  await page.locator('#ticket-section-history-heading').click();await page.locator('.ticket-history').getByText('Northstar account',{exact:false}).first().waitFor();await page.locator('.ticket-history').getByText('Harbor account',{exact:false}).first().waitFor();await capture('06-ticket-history');
  await api(base+`/companies/${company.id}/members/${contact.id}`,{},'PUT');
  await page.goto(origin+`/projects/${p}/macros/create`);await page.getByLabel('Title',{exact:true}).fill('Restore support account');await page.getByLabel('Content',{exact:true}).fill('We will help with your account.');await page.getByLabel('Set Support account',{exact:true}).check();
  const macroAccount=page.getByLabel('Support account',{exact:true});assert.equal(await macroAccount.inputValue(),'');await macroAccount.selectOption({label:'Northstar account'});assert.equal(await macroAccount.inputValue(),company.id);await capture('08-macro-account-choice');
  await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();
  await page.goto(origin+`/projects/${p}/conversations/${ticketId}`);await page.locator('#conversation-composer-tools').click();await page.getByRole('menuitem',{name:'Saved replies',exact:true}).click();await page.getByRole('link',{name:'Restore support account',exact:true}).click();
  const macroPreview=page.getByRole('region',{name:'Macro preview',exact:true});await macroPreview.waitFor();assert.ok((await macroPreview.innerText()).includes('Harbor account → Northstar account'));assert.ok(!(await macroPreview.innerText()).includes(company.id));assert.ok(!(await macroPreview.innerText()).includes(secondary.id));await capture('09-macro-account-preview');

  await page.goto(origin+`/projects/${p}/conversations`);await page.getByRole('button',{name:'Filters',exact:true}).click();await page.getByRole('button',{name:'Save as view…',exact:true}).click();await page.getByRole('button',{name:'Add filter',exact:true}).click();await page.getByLabel('Filter 1 field').selectOption(`custom:${field.id}`);await page.getByLabel('Value',{exact:true}).selectOption({label:'Northstar account'});assert.equal(await page.getByLabel('Value',{exact:true}).inputValue(),company.id);await capture('07-account-view-filter');
  await page.getByLabel('View name',{exact:true}).fill('Northstar account requests');await page.getByRole('button',{name:'Save new view',exact:true}).click();await page.getByText('View saved.',{exact:true}).waitFor();assert.equal((await api(base+'/ticket-views')).data.find(view=>view.name==='Northstar account requests').filters[0].value,company.id)
  assert.ok(offerInputs.length>0);assert.ok(offerInputs.every(values=>Object.keys(values).every(id=>id===field.id)),'offer refresh never puts unrelated form contents in a URL');
  await customerContext.close();await context.close();success=true;console.log('Account lookup: configured, refused, submitted and inspected; browser proof at 1440 and 390.')
 }finally{await browser.close();await runtime.close(success);await rm(scratch,{recursive:true,force:true})}
}
