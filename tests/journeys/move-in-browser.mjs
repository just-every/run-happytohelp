import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {randomBytes} from 'node:crypto'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {reviewExplanations} from '../move-in/outcomes-policy.mjs'
import {generate} from '../move-in/generator.mjs'
import {launchBrowser,evidence} from './kit/browser.mjs'

// Move in in a real browser against the emitted Worker: one owner workspace, every
// screen axe-checked for serious findings and horizontal overflow at its width.
let runtime,browser,context,page,request,project,token,base,shot,success=true
const errors=[],results=[],owner={email:'move-in-browser@example.test',password:randomBytes(24).toString('base64url')}
const axe=await readFile(new URL('../../node_modules/axe-core/axe.min.js',import.meta.url),'utf8')
async function inspect(name){await page.addScriptTag({content:axe});const result=await page.evaluate(async()=>{const scan=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return {violations:scan.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),overflow:document.documentElement.scrollWidth>innerWidth+1}});assert.deepEqual(result.violations,[],name);assert.equal(result.overflow,false,name);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:shot(`${name}.png`),fullPage:true});results.push({name,...result})}
before(async()=>{
 runtime=await createRuntime({queueConsumers:true});shot=await evidence('move-in')
 request=async(path,{body,method=body===undefined?'GET':'POST',token}={})=>{const response=await fetch(runtime.origin+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(response.ok,`${method} ${path} ${response.status}`);return response.json()}
 const setup=await request('/api/identity/bootstrap',{body:{...owner,name:'Import Owner',allowedOrigin:runtime.origin}});project=setup.projectId;token=(await request('/api/identity/login',{body:owner})).token;base=`/projects/${project}`
 browser=await launchBrowser();context=await browser.newContext({viewport:{width:1440,height:1000},bypassCSP:true});page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{errors.push('Unexpected script dialog');await dialog.dismiss()})
 await page.goto(runtime.origin+'/login?returnTo='+encodeURIComponent(base+'/conversations'));await page.getByLabel('Email',{exact:true}).fill(owner.email);await page.getByLabel('Password',{exact:true}).fill(owner.password);await page.getByRole('button',{name:'Login',exact:true}).click();await page.waitForURL('**/conversations')
})
after(async()=>{await writeFile(shot('checks.json'),JSON.stringify({checks:results,errors},null,2)).catch(()=>{});await browser?.close();await runtime?.close(success)})
const guarded=body=>async()=>{try{await body();assert.deepEqual(errors,[])}catch(error){success=false;throw error}}

async function vendorJourney(width,vendor){
  const label=`${vendor}-${width}`,content=generate(vendor,6,width),filename=`${label}.jsonl`;await page.setViewportSize({width,height:1000});await page.goto(runtime.origin+base+'/move-in');
  await page.getByLabel('Export format',{exact:true}).selectOption(vendor);await page.getByLabel('Export file',{exact:true}).setInputFiles({name:filename,mimeType:'application/octet-stream',buffer:Buffer.from(content)});await page.getByRole('button',{name:'Upload and review',exact:true}).click();
  await page.getByRole('heading',{name:`Ready for review: ${filename}`,exact:true}).waitFor({timeout:120000});assert.match(await page.locator('.move-in-page').innerText(),/Articles: 1 will be published, 1 will stay a draft/);await inspect(`${label}-plan`);
  await page.getByRole('button',{name:'Approve and import',exact:true}).click();await page.getByRole('heading',{name:`Importing: ${filename}`,exact:true}).waitFor();assert.match(await page.locator('.move-in-page').innerText(),/\d+ of \d+ source records processed/);await inspect(`${label}-progress`);
  await page.getByRole('heading',{name:`Complete: ${filename}`,exact:true}).waitFor({timeout:120000});await page.getByRole('heading',{name:'Imported records',exact:true}).scrollIntoViewIfNeeded();await inspect(`${label}-report`);
  assert.equal(await page.getByRole('link',{name:/^Open conversation /}).count(),6);assert.equal(await page.getByRole('link',{name:/^Open article /}).count(),2);assert.equal(await page.getByRole('link',{name:/^Open contact /}).count(),6);assert.equal(await page.getByRole('link',{name:/^Open saved reply /}).count(),1);
  await page.getByRole('button',{name:'Upload and review',exact:true}).click();await page.getByText('This export was already processed.',{exact:false}).waitFor();
  await page.getByRole('link',{name:/^Open conversation /}).first().click();const details=page.getByRole('tab',{name:'Ticket',exact:true}),panelToggle=page.getByRole('button',{name:'Show conversation panel',exact:true});await details.or(panelToggle).first().waitFor();if(!await details.isVisible())await panelToggle.click();await details.click();await page.getByText(`Imported from ${vendor}; source 10001, open. Excluded from Reports.`,{exact:true}).waitFor();await page.locator('.transcript-message-time').first().waitFor({state:'attached'});
  assert.ok(await page.locator('.transcript-message-time').count()>0);
  const input=page.getByRole('textbox',{name:'New tag',exact:true});await input.fill('Review me');await input.locator('..').getByRole('button',{name:'Add',exact:true}).click();const remove=page.getByRole('button',{name:'Remove tag Review me',exact:true});await remove.waitFor();await inspect(`${label}-tag-added`);await remove.click();await remove.waitFor({state:'hidden'});await inspect(`${label}-tag-removed`);
  await page.goto(runtime.origin+base+'/conversations');await page.getByRole('button',{name:'Filters',exact:true}).click();const filter=page.getByRole('combobox',{name:'Filter conversations by tag'});await filter.waitFor();await page.locator('.conversation-item').first().waitFor();
  // Imported closed history is in Closed, so the Open view already shows only the three Priority rows.
  // Mark them: a new filter starts from an empty list, so only rows rendered for the filter lack the mark.
  await page.evaluate(()=>document.querySelectorAll('.conversation-item').forEach(row=>{row.dataset.beforeFilter='1'}));await filter.selectOption({label:'Priority'});
  await page.waitForFunction(()=>document.querySelectorAll('.conversation-item').length===3&&!document.querySelector('.conversation-item[data-before-filter]')&&[...document.querySelectorAll('.conversation-item .conversation-tag')].filter(tag=>tag.textContent.includes('Priority')).length===3);
  assert.equal(await page.locator('.conversation-item').count(),3);assert.equal(await page.locator('.conversation-item .conversation-tag').filter({hasText:'Priority'}).count(),3);await inspect(`${label}-tag-filter`);
  await page.goto(runtime.origin+base+'/move-in');await page.getByRole('button',{name:`${filename} — Complete`,exact:true}).click();await page.getByRole('button',{name:'Undo whole import',exact:true}).click();await page.getByRole('heading',{name:`Undone: ${filename}`,exact:true}).waitFor({timeout:120000});await inspect(`${label}-undone`);
  const listed=await request(`/api/dashboard/projects/${project}/conversations?view=all`,{token});assert.equal(listed.meta.pagination.total,0);

}

test('an owner reviews a Zendesk export, imports its history, opens and filters imported tickets, detects a repeat and undoes the complete import',guarded(async()=>{
 await page.goto(runtime.origin+base+'/settings')
 await page.getByRole('link',{name:'Move in existing support history',exact:true}).click()
 await page.getByRole('heading',{name:'Move in',exact:true}).waitFor()
 await vendorJourney(1440,'zendesk')
 await reviewExplanations(page,runtime.origin,base,shot)
 await configurationBrowser(1440)
 await configurationBrowser(390)
}))


async function configurationBrowser(width){
 await page.setViewportSize({width,height:900})
 const n=width*100,dates={created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'},name=`configuration-${width}.jsonl`,ruleName=`Priority review ${width}`,calendarName=`Business hours ${width}`,groupName=`Billing ${width}`,viewName=`Open work ${width}`
 const formField={id:n+20,type:'text',title:'Order reference',title_in_portal:'Order reference',description:'Your order number',active:true,required:false,visible_in_portal:true,editable_in_portal:true,required_in_portal:true,agent_can_edit:true,...dates};
 const form=id=>({ticket_form:{id,name:'Order request '+id,display_name:'Order request '+id,active:true,default:false,end_user_visible:true,in_all_brands:true,restricted_brand_ids:[],ticket_field_ids:[formField.id],agent_conditions:[],end_user_conditions:[],...dates}});
 const records=[{organization:{id:n+30,name:'Northstar workshop '+width,domain_names:[`configuration-${width}.example`],shared_tickets:true,...dates}},{ticket_field:formField},form(n+21),form(n+22),{user:{id:n+1,role:'end-user',name:'Configuration customer',email:`configuration-${width}@example.test`,organization_id:n+30,created_at:dates.created_at}},{ticket:{id:n+2,requester_id:n+1,subject:`Configuration ticket ${width}`,status:'open',via:{channel:'email'},comments:[{id:n+3,author_id:n+1,body:'A historical configuration example',public:true,created_at:dates.created_at}],...dates}},
  {group:{id:n+4,name:groupName,deleted:false,default:false,...dates}},{group:{id:n+5,name:`Technical ${width}`,deleted:false,default:false,...dates}},
  {schedule:{id:n+6,name:calendarName,time_zone:'UTC',intervals:[{start_time:1980,end_time:2460}],holidays:[{id:n+7,name:'Holiday',start_date:'2024-12-25',end_date:'2024-12-25'}],...dates}},
  {view:{id:n+8,title:viewName,active:true,restriction:null,conditions:{all:[{field:'status',operator:'is',value:'open'}],any:[]},execution:{sort_by:'updated_at',sort_order:'desc'},...dates}},
  {trigger:{id:n+9,title:ruleName,active:true,position:1,conditions:{all:[{field:'priority',operator:'is',value:'normal'}],any:[]},actions:[{field:'priority',value:'high'}],...dates}},
  {sla_policy:{id:n+40,title:`Normal response ${width}`,position:0,filter:{all:[],any:[]},move_in_schedule_id:n+6,policy_metrics:[{priority:'normal',metric:'first_reply_time',target:120,business_hours:true}],...dates}},
  {sla_policy:{id:n+41,title:`Unsupported SLA ${width}`,position:1,filter:{all:[{field:'group_id',operator:'is',value:n+4}],any:[]},move_in_schedule_id:n+6,policy_metrics:[{priority:'normal',metric:'first_reply_time',target:120,business_hours:true}],...dates}},
  {automation:{id:n+10,title:`Pending review ${width}`,active:true,position:2,conditions:{all:[{field:'status',operator:'is',value:'pending'},{field:'hours_since_created',operator:'greater_than',value:'1'}],any:[]},actions:[{field:'priority',value:'urgent'}],...dates}}]
 await page.goto(runtime.origin+base+'/move-in');await page.getByLabel('Export format',{exact:true}).selectOption('zendesk');await page.getByLabel('Export file',{exact:true}).setInputFiles({name,mimeType:'application/octet-stream',buffer:Buffer.from(records.map(JSON.stringify).join('\n'))});await page.getByRole('button',{name:'Upload and review',exact:true}).click();await page.getByRole('heading',{name:`Ready for review: ${name}`,exact:true}).waitFor({timeout:120000});await page.locator('summary').filter({hasText:'Imported with notes'}).click();await page.getByText('The rule is a draft.',{exact:false}).first().waitFor();assert.doesNotMatch(await page.locator('.move-in-page').innerText(),/Articles: 0 will be published/);if(width===1440){await page.getByText('This whole SLA policy is set aside:',{exact:false}).waitFor();await page.getByRole('link',{name:'Review native SLA policies',exact:true}).waitFor();assert.match(await page.locator('.move-in-page').innerText(),new RegExp(name+', line [0-9]+'));await page.getByText('Review the explicit calendar association:',{exact:false}).waitFor();await page.getByText('First response: 120 business minutes for normal priority only.',{exact:false}).waitFor();}if(width===390){
  for(const name of ['Toggle navigation','Account menu']){
   const control=page.getByRole('button',{name,exact:true}).filter({visible:true}),tip=page.locator('.ui-tooltip[data-open]').filter({hasText:name});
   await control.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await tip.waitFor();await inspect(`configuration-${name.toLowerCase().replaceAll(' ','-')}-focus-${width}`);await control.blur();await page.mouse.move(200,200);await control.hover();await tip.waitFor();await page.mouse.move(200,200);
  }
 }
 await inspect(`configuration-review-${width}`)
 await page.getByRole('button',{name:'Approve and import',exact:true}).click();await page.getByRole('heading',{name:`Complete: ${name}`,exact:true}).waitFor({timeout:120000});await inspect(`configuration-report-${width}`)
 const report=async()=>{await page.goto(runtime.origin+base+'/move-in');await page.getByRole('button',{name:`${name} — Complete`,exact:true}).click();await page.getByRole('heading',{name:`Complete: ${name}`,exact:true}).waitFor()}
 await page.getByRole('link',{name:`Review workflow rule “${ruleName}”`,exact:true}).click();await page.getByRole('heading',{name:`1. ${ruleName}`,exact:true}).waitFor();const rule=page.locator('article.workflow-item').filter({has:page.getByRole('heading',{name:`1. ${ruleName}`,exact:true})});await rule.getByRole('button',{name:'Preview draft',exact:true}).click();await page.getByRole('heading',{name:`Preview: ${ruleName}`,exact:true}).waitFor();await page.getByText('No messages sent and no tickets changed.',{exact:false}).waitFor();await inspect(`configuration-rule-preview-${width}`)
 await report();await page.getByRole('link',{name:`Review business calendar “${calendarName}”`,exact:true}).click();await page.getByRole('heading',{name:calendarName,exact:true}).waitFor();await page.getByText('UTC · Inactive',{exact:false}).waitFor();await page.getByText('Closed: 2024-12-25',{exact:false}).waitFor();await inspect(`configuration-calendar-${width}`)
 await report();await page.getByRole('link',{name:`Review SLA policy “Normal response ${width}”`,exact:true}).click();await page.getByRole('heading',{name:`0. Normal response ${width}`,exact:true}).waitFor();if(width===1440)await page.getByText(`Inactive · ${calendarName}`,{exact:true}).waitFor();await inspect(`configuration-policy-${width}`);
 await report();await page.getByRole('link',{name:`Review group “${groupName}”`,exact:true}).click();await page.getByRole('heading',{name:groupName,exact:true}).waitFor();await inspect(`configuration-groups-${width}`)
 await report();await page.getByRole('link',{name:`Review saved view “${viewName}”`,exact:true}).click();await page.locator('.conversation-item').filter({hasText:`Configuration ticket ${width}`}).waitFor();await inspect(`configuration-view-${width}`)
 await report();await page.getByRole('link',{name:'Review form “Order request '+(n+21)+'”',exact:true}).click();await page.getByRole('heading',{name:'Request forms',exact:true}).waitFor();await page.getByRole('heading',{name:'Order request '+(n+21),exact:true}).waitFor();await inspect(`configuration-forms-${width}`);
 await report();await page.getByRole('link',{name:'Review field “Order reference”',exact:true}).click();await page.getByRole('heading',{name:'Order reference',exact:true}).waitFor();await inspect(`configuration-fields-${width}`);
 await report();await page.getByRole('link',{name:'Review company “Northstar workshop '+width+'”',exact:true}).click();await page.getByRole('button',{name:'Northstar workshop '+width,exact:true}).click();await page.getByRole('heading',{name:'Northstar workshop '+width,exact:true}).waitFor();await inspect(`configuration-company-${width}`);
 await report();await page.getByRole('button',{name:'Undo whole import',exact:true}).click();await page.getByRole('heading',{name:`Undone: ${name}`,exact:true}).waitFor({timeout:120000})
}
