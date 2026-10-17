import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {notificationPreferencesJourney} from '../notification-preferences-browser.mjs';
import {createRuntime} from '../emitted-runtime.mjs';
import {launchBrowser} from '../../journeys/kit/browser.mjs'

export async function managementLibrary(){

// Management and library pages on the emitted Worker with real local D1/R2: one shared delete confirmation,
// mobile tables that keep every column and action reachable, validated training-run and create forms.
const evidenceDir=join(process.env.H2H_EVIDENCE_DIR?resolve(process.env.H2H_EVIDENCE_DIR):await mkdtemp(join(tmpdir(),'h2h-management-library-')),'management-library');
await mkdir(evidenceDir,{recursive:true});console.log('Management library browser evidence:',evidenceDir);
const runtime=await createRuntime({queueConsumers:true,vars:{EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-management-mail',EMAIL_FROM:'support@example.test'},outboundFixture:new URL('../notification-mail-fixture.mjs',import.meta.url).href,port:Number(process.env.H2H_TEST_PORT)||0,inspectorPort:process.env.H2H_RUNTIME_INSPECTOR_PORT?Number(process.env.H2H_RUNTIME_INSPECTOR_PORT):undefined}),origin=runtime.origin;
let browser,success=false;
const request=async(path,{token,body,method=body===undefined?'GET':'POST',raw=false}={})=>{const response=await fetch(origin+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});if(raw)return response;assert.ok(response.ok,`${method} ${path}: ${response.status} ${await response.clone().text()}`);return response.json();};
const results=[],failures=[];
let diagnostic;
const only=process.env.H2H_CHECK_FILTER?new RegExp(process.env.H2H_CHECK_FILTER,'i'):null;
const check=async(name,work,page)=>{if(only&&!only.test(name))return;try{await work();results.push(name);console.log('PASS',name);}catch(error){failures.push({name,message:String(error?.message||error).split('\n').slice(0,6).join(' | ')});console.log('FAIL',name,'-',String(error?.message||error).split('\n')[0]);if(page)await page.screenshot({path:join(evidenceDir,`failure-${name.replace(/\W+/g,'-').slice(0,60)}.png`)}).catch(()=>{});if(page)console.log('   html',(await page.locator('details').first().evaluate(e=>e.outerHTML).catch(()=>'no details')).slice(0,300));if(page)console.log('   at',page.url(),(await page.locator('body').innerText().catch(()=>'')).slice(0,200).replace(/\n/g,' / '));}};
try{
 const owner={email:'library-owner@example.test',password:'synthetic-native-library-test-password-2026'};
 const setup=await request('/api/identity/bootstrap',{body:{...owner,name:'Library Owner',allowedOrigin:origin}}),projectId=setup.projectId;
 const login=await request('/api/identity/login',{body:owner}),token=login.token,api=`/api/management/projects/${projectId}`,knowledge=`/api/knowledge/${projectId}`;
 const project=await request(`/api/identity/projects/${projectId}`,{token});
 const make=async(kind,body)=>(await request(`${api}/${kind}`,{token,body})).data;
 const remaining=async(kind,id)=>(await request(`${api}/${kind}`,{token})).data.some(row=>row.id===id);
 // A second owner (so self-removal is possible without orphaning the project) and a plain agent.
 const joinAs=async(email,name)=>{const invite=await request(`${api}/agents`,{token,body:{email,role:'operator'}});await request('/api/identity/accept-token',{body:{token:new URL(invite.data.invitationUrl).searchParams.get('token'),name,password:'synthetic-native-library-member-2026'}});const row=(await request(`${api}/agents`,{token})).data.find(agent=>agent.email===email);assert.ok(row?.id,'member joined');return row;};
 const second=await joinAs('second-owner@example.test','Second Owner'),helper=await joinAs('helper-agent@example.test','Helper Agent');

 const macro=await make('macros',{title:'Greeting reply',content:'Hello {{contact.name}}'});
 const contact=await make('contacts',{name:'Long Email Contact',email:'a.very.long.contact.address.for.mobile@studio-marin-long-domain.example.test'});
 const assistant=await make('ais',{name:'Delete Me AI',role:'Delete helper',model:'gpt-5.6-luna',prompt:'Be helpful.'});
 const plugin=await make('plugins',{name:'Delete Me Plugin',url:'https://example.test/plugin'});
 const article=(await request(`${knowledge}/articles`,{token,body:{title:'Install the chat widget',slug:'install-widget',content:'Steps.',status:'published'}}));
 const category=(await request(`${knowledge}/categories`,{token,body:{name:'Getting started'}}));
 const dataset=(await request(`${knowledge}/datasets`,{token,body:{name:'Docs',url:'https://example.test/docs',max_crawl_depth:3,max_crawl_pages:50}}));

 browser=await launchBrowser();
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 const pageErrors=[],nativeDialogs=[],deletes=[],posts=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 page.on('dialog',async dialog=>{nativeDialogs.push(`${dialog.type()}: ${dialog.message()}`);await dialog.dismiss();});
 page.on('request',req=>{const url=new URL(req.url());if(!url.pathname.startsWith('/api/'))return;if(req.method()==='DELETE')deletes.push(url.pathname);if(req.method()==='POST')posts.push(url.pathname);});
 await page.goto(origin+'/login?returnTo='+encodeURIComponent(`/projects/${projectId}/conversations`));await page.getByLabel('Email',{exact:true}).fill(owner.email);await page.getByLabel('Password',{exact:true}).fill(owner.password);await page.getByRole('button',{name:'Login',exact:true}).click();await page.waitForURL('**/conversations');
 const base=`${origin}/projects/${projectId}`,shot=name=>page.screenshot({path:join(evidenceDir,name),fullPage:true});

 await check('notification preferences: sole owner saves, reloads and receives unassigned activity',()=>notificationPreferencesJourney({page,request,runtime,token,owner,projectId,project:project.project||project,evidenceDir}),page);
 await request(`${api}/agents/${second.id}`,{token,method:'PUT',body:{role:'owner'}});
 // 1. One shared in-app confirmation for every destructive delete.
 const deleteCases=[
  {name:'saved reply',url:`${base}/macros/${macro.id}`,list:`${base}/macros`,subject:'Greeting reply',gone:()=>remaining('macros',macro.id)},
  {name:'contact',url:`${base}/contacts/${contact.id}`,list:`${base}/contacts`,subject:'Long Email Contact',gone:()=>remaining('contacts',contact.id)},
  {name:'AI assistant',url:`${base}/ais/${assistant.id}`,list:`${base}/ais`,subject:'Delete Me AI',gone:()=>remaining('ais',assistant.id)},
  {name:'plugin',url:`${base}/plugins/${plugin.id}`,list:`${base}/plugins`,subject:'Delete Me Plugin',gone:()=>remaining('plugins',plugin.id)},
  {name:'agent',url:`${base}/agents/${helper.id}`,list:`${base}/agents`,subject:'Helper Agent',gone:()=>remaining('agents',helper.id)},
  {name:'article',url:`${base}/articles/${article.id}`,list:`${base}/articles`,subject:'Install the chat widget',gone:async()=>(await request(`${knowledge}/articles`,{token})).some(row=>row.id===article.id)},
  {name:'category',url:`${base}/categories/${category.id}`,list:`${base}/categories`,subject:'Getting started',gone:async()=>(await request(`${knowledge}/categories`,{token})).some(row=>row.id===category.id)},
 ];
 for(const item of deleteCases)await check(`delete ${item.name}: in-app dialog, cancel and Escape change nothing, confirm deletes`,async()=>{
  nativeDialogs.length=0;deletes.length=0;
  await page.goto(item.url);const trigger=page.getByRole('button',{name:'Delete',exact:true});await trigger.waitFor();
  await trigger.click();
  const dialog=page.getByRole('dialog');await dialog.waitFor({timeout:3000});
  assert.match(await dialog.innerText(),new RegExp(item.subject.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),'dialog names the record');
  assert.equal(await dialog.getAttribute('aria-modal'),'true');assert.ok(await dialog.getAttribute('aria-labelledby'),'dialog has an accessible name');
  assert.deepEqual(deletes,[],'no DELETE before confirmation');
  await shot(`desktop-${item.name.replace(/\W+/g,'-')}-confirm.png`);
  // Tab and Shift+Tab wrap inside the dialog; a native modal alone lets focus leave for the browser chrome.
  for(const key of ['Tab','Shift+Tab'])for(let press=1;press<=4;press++){await page.keyboard.press(key);assert.equal(await dialog.evaluate(element=>element.contains(document.activeElement)&&document.activeElement!==element&&document.activeElement.matches('button:not(:disabled), input:not(:disabled)')),true,`${key} press ${press} keeps focus on a dialog control`);}
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.equal(await trigger.evaluate(element=>element===document.activeElement),true,'focus returns to Delete after Cancel');
  await trigger.click();await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.deepEqual(deletes,[],'Cancel/Escape send no DELETE');assert.equal(await item.gone(),true,'record still exists');
  await trigger.click();await dialog.waitFor();await dialog.getByRole('button',{name:'Delete',exact:true}).click();
  await page.waitForURL(item.list);assert.equal(deletes.length,1,'exactly one DELETE after confirmation');assert.equal(await item.gone(),false,'record removed');
  assert.deepEqual(nativeDialogs,[],'no native browser dialog');
 });
 // Dataset deletion goes through the same dialog (Settings tab).
 await check('delete dataset: in-app dialog before the DELETE',async()=>{
  nativeDialogs.length=0;deletes.length=0;
  await page.goto(`${base}/datasets/${dataset.id}`);await page.locator('ul.nav-tabs.mb-4').getByRole('button',{name:'Settings',exact:true}).click();
  const trigger=page.getByRole('button',{name:'Delete',exact:true});await trigger.click();const dialog=page.getByRole('dialog');await dialog.waitFor({timeout:3000});
  assert.deepEqual(deletes,[]);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await trigger.click();await dialog.getByRole('button',{name:'Delete',exact:true}).click();await page.waitForURL(`${base}/datasets`);assert.equal(deletes.length,1);assert.deepEqual(nativeDialogs,[]);
 });
 // The dialog itself is accessible at desktop and phone width (axe-core, as the accessibility suite uses).
 await check('confirmation dialog: no axe violations at desktop and phone width, typed confirmation is labelled',async()=>{
  const axe=await readFile(join(resolve(new URL('../../..',import.meta.url).pathname),'node_modules/axe-core/axe.min.js'),'utf8');
  const fresh=await request(`${knowledge}/articles`,{token,body:{title:'Axe dialog article',slug:'axe-dialog-article',content:'Steps.',status:'draft'}});
  for(const viewport of [{width:1440,height:1000},{width:320,height:568}]){
   await page.setViewportSize(viewport);await page.goto(`${base}/articles/${fresh.id}`);await page.getByRole('button',{name:'Save',exact:true}).waitFor();if(viewport.width<600)await page.getByRole('button',{name:'More actions',exact:true}).click();await page.getByRole('button',{name:'Delete',exact:true}).click();
   const dialog=page.getByRole('dialog',{name:/Axe dialog article/});await dialog.waitFor({timeout:3000});
   await page.evaluate(axe);const result=await page.evaluate(async()=>{const run=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}});return run.violations.map(v=>`${v.id}: ${v.nodes.map(n=>n.target.join(' ')).join(', ')}`)});
   assert.deepEqual(result,[],`axe violations at ${viewport.width}px`);
   assert.equal(await dialog.evaluate(element=>element.getBoundingClientRect().right<=window.innerWidth&&element.getBoundingClientRect().left>=0),true,'dialog fits the viewport');
   await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  }
  await page.setViewportSize({width:1440,height:1000});
 },page);
 // Row menus in the article and category lists use the same dialog.
 for(const [kind,subject,create,list] of [['article','Row menu article',()=>request(`${knowledge}/articles`,{token,body:{title:'Row menu article',slug:'row-menu-article',content:'Steps.',status:'published'}}),`${base}/articles`],['category','Row menu category',()=>request(`${knowledge}/categories`,{token,body:{name:'Row menu category'}}),`${base}/categories`]])await check(`list row menu: ${kind} Delete opens the dialog, Cancel changes nothing, confirm removes the row`,async()=>{
  await create();nativeDialogs.length=0;deletes.length=0;
  await page.goto(list);await page.getByRole('link',{name:subject,exact:true}).waitFor();await page.waitForLoadState('networkidle');const openMenu=async()=>{const summary=page.getByLabel(`Actions for ${subject}`);if(!await summary.evaluate(element=>element.parentElement.open))await summary.click();await page.getByRole('button',{name:'Delete',exact:true}).click();};await openMenu();
  const dialog=page.getByRole('dialog');await dialog.waitFor({timeout:3000});assert.match(await dialog.innerText(),new RegExp(subject));assert.deepEqual(deletes,[]);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.deepEqual(deletes,[]);assert.equal(await page.getByRole('link',{name:subject,exact:true}).count()>0,true);
  await openMenu();await dialog.getByRole('button',{name:'Delete',exact:true}).click();
  await page.getByRole('link',{name:subject,exact:true}).waitFor({state:'detached'});assert.equal(deletes.length,1);assert.deepEqual(nativeDialogs,[]);
 },page);
 // 2. Mobile management tables keep every column and action reachable.
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),m=await mobile.newPage();
 await m.goto(origin+'/login?returnTo='+encodeURIComponent(`/projects/${projectId}/conversations`));await m.getByLabel('Email',{exact:true}).fill(owner.email);await m.getByLabel('Password',{exact:true}).fill(owner.password);await m.getByRole('button',{name:'Login',exact:true}).click();await m.waitForURL('**/conversations');
 await make('contacts',{name:'Mobile Contact',email:'a.very.long.contact.address.for.mobile@studio-marin-long-domain.example.test'}); await make('macros',{title:'Mobile reply',content:'x'});await make('plugins',{name:'Mobile plugin',url:'https://example.test/m'});
 await request(`${knowledge}/datasets`,{token,body:{name:'Mobile docs',url:'https://example.test/mobile-docs-with-a-long-address',max_crawl_depth:3,max_crawl_pages:50}});
 await request(`${knowledge}/articles`,{token,body:{title:'Mobile article',slug:'mobile-article',content:'Steps.',status:'published'}});
 for(const section of ['macros','contacts','agents','plugins','datasets','articles'])await check(`mobile ${section}: no column or action is clipped or hidden behind a hidden scroll`,async()=>{
  await m.goto(`${base}/${section}`);await m.locator('table').first().waitFor();await m.waitForTimeout(300);
  const layout=await m.evaluate(()=>{const width=document.documentElement.clientWidth;return [...document.querySelectorAll('table')].map(table=>{const wrap=table.closest('.table-responsive')||table.parentElement;const cells=[...table.querySelectorAll('tbody td, tbody th')].filter(cell=>cell.getClientRects().length);const clipped=cells.map(cell=>{const box=cell.getBoundingClientRect();return {text:cell.innerText.trim().slice(0,40),left:Math.round(box.left),right:Math.round(box.right)}}).filter(box=>box.left<-1||box.right>width+1);const links=[...table.querySelectorAll('tbody a, tbody summary, tbody button')].map(link=>({text:(link.getAttribute('aria-label')||link.innerText).trim().slice(0,40),right:Math.round(link.getBoundingClientRect().right),visible:link.getClientRects().length>0}));const text=value=>value.replace(/\s+/g,' ').trim();const unseen=cells.filter(cell=>!text(cell.innerText).includes(text(cell.textContent))).map(cell=>text(cell.textContent).slice(0,60));return {scrollWidth:wrap.scrollWidth,clientWidth:wrap.clientWidth,clipped,unseen,offscreenActions:links.filter(link=>link.visible&&link.right>width+1),hiddenActions:links.filter(link=>!link.visible),documentOverflow:document.documentElement.scrollWidth>width+1}})});
  assert.ok(layout.length>0,'a table is shown');
  for(const table of layout){assert.ok(table.scrollWidth<=table.clientWidth+1,`table scrolls sideways inside its wrapper (${table.scrollWidth} > ${table.clientWidth})`);assert.deepEqual(table.clipped,[],'cells outside the viewport');assert.deepEqual(table.offscreenActions,[],'actions outside the viewport');assert.deepEqual(table.hiddenActions,[],'actions folded away on the phone');assert.deepEqual(table.unseen,[],'cell content not rendered');assert.equal(table.documentOverflow,false,'page overflow');}
  await m.screenshot({path:join(evidenceDir,`mobile-${section}.png`),fullPage:true});
 },m);
 await mobile.close();

 // 3. Training runs form: field-level validation, empty state, one name, explained limits.
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),t=await ctx.newPage();
 const trainingPosts=[];t.on('request',req=>{if(req.method()==='POST'&&new URL(req.url()).pathname.includes('/training/'))trainingPosts.push(req.url())});
 await t.goto(origin+'/login?returnTo='+encodeURIComponent(`/projects/${projectId}/conversations`));await t.getByLabel('Email',{exact:true}).fill(owner.email);await t.getByLabel('Password',{exact:true}).fill(owner.password);await t.getByRole('button',{name:'Login',exact:true}).click();await t.waitForURL('**/conversations');
 await check('training runs: one name, empty state, explained limits',async()=>{
  await t.goto(`${base}/training-runs`);await t.getByRole('button',{name:'Create run'}).waitFor();
  const headings=await t.getByRole('heading',{level:1}).allInnerTexts(),activeTab=await t.locator('.header-tabs .nav-link.active').innerText();
  assert.equal(headings[0].trim().toLowerCase(),activeTab.trim().toLowerCase(),`page heading ${headings} matches active tab ${activeTab}`);
  assert.equal(await t.getByRole('heading',{name:headings[0].trim(),exact:true}).count(),1,'the title is not repeated by a section heading');
  assert.match(await t.locator('main, .main-content, body').first().innerText(),/No (evaluation )?runs yet/i,'empty state');
  const text=await t.locator('main, .main-content, body').first().innerText();
  assert.match(text,/greater than 0|must be above 0|at least/i,'cost limit explained');assert.match(text,/32,?000/,'token limit explained');
  const options=await t.getByLabel('Run type').locator('option').allInnerTexts();assert.deepEqual(options,['Evaluation','Simulation']);
  await shot2(t,'desktop-training-runs.png');
 });
 await check('training runs: invalid input shows field messages, never a raw JSON.parse error, and sends nothing',async()=>{
  trainingPosts.length=0;await t.goto(`${base}/training-runs`);await t.getByLabel('Models',{exact:false}).first().fill('gpt-5.6-luna');
  await t.getByLabel('Case definitions',{exact:false}).fill('{not json');await t.getByLabel('Maximum cost',{exact:false}).fill('0');await t.getByLabel('Maximum tokens',{exact:false}).fill('999999');
  await t.getByRole('button',{name:'Create run'}).click();
  const text=await t.locator('body').innerText();
  assert.doesNotMatch(text,/Expected property name|JSON\.parse|position \d|Unexpected token|is not valid JSON/i,'no raw parser text');
  assert.match(text,/Case definitions/i);assert.ok(await t.getByRole('alert').count()>0,'validation is announced');
  assert.equal(await t.getByLabel('Case definitions',{exact:false}).getAttribute('aria-invalid'),'true');
  assert.deepEqual(trainingPosts,[],'no request for invalid input');await shot2(t,'desktop-training-bad-json.png');
 });
 await check('training runs: a valid run is created and listed',async()=>{
  trainingPosts.length=0;await t.goto(`${base}/training-runs`);await t.getByLabel('Models',{exact:false}).first().fill('gpt-5.6-luna');
  await t.getByLabel('Case definitions',{exact:false}).fill('[{"id":"case-1","type":"customer-reply"}]');await t.getByLabel('Maximum cost',{exact:false}).fill('5');await t.getByLabel('Maximum tokens',{exact:false}).fill('2000');
  const created=t.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith('/runs'));
  await t.getByRole('button',{name:'Create run'}).click();const response=await created;assert.equal(response.status(),201,await response.text());
  await t.getByRole('button',{name:/evaluation/i}).first().waitFor();
  for(const label of ['Models','Case definitions','Maximum cost','Maximum tokens'])assert.equal(await t.getByLabel(label,{exact:false}).first().inputValue(),'','committed run clears its creation draft');
  const navigationWarnings=[];t.on('dialog',async dialog=>{navigationWarnings.push(dialog.message());await dialog.accept();});
  await t.getByRole('navigation',{name:'Knowledge sections'}).getByRole('link',{name:'Website sources',exact:true}).click();await t.waitForURL(`${base}/datasets`);
  assert.deepEqual(navigationWarnings,[],'successful creation leaves no unsaved-change warning');
 });
 await ctx.close();

 // 4. Create forms validate in the browser and on the server.
 const forms=await browser.newContext({viewport:{width:1440,height:1000}}),f=await forms.newPage();const formPosts=[];f.on('request',req=>{if(req.method()==='POST'||req.method()==='PUT'){const path=new URL(req.url()).pathname;if(/\/(datasets|contacts|plugins)(\/|$)/.test(path))formPosts.push(path)}});
 await f.goto(origin+'/login?returnTo='+encodeURIComponent(`/projects/${projectId}/conversations`));await f.getByLabel('Email',{exact:true}).fill(owner.email);await f.getByLabel('Password',{exact:true}).fill(owner.password);await f.getByRole('button',{name:'Login',exact:true}).click();await f.waitForURL('**/conversations');
 await check('dataset form: negative and absurd crawl limits are refused in the browser',async()=>{
  formPosts.length=0;await f.goto(`${base}/datasets/create`);await f.getByLabel('Starting URL').fill('https://example.test');
  await f.getByLabel('Max Crawl Depth').fill('-5');await f.getByLabel('Max Crawl Pages').fill('99999999');await f.getByRole('button',{name:'Add URL'}).click();
  assert.deepEqual(formPosts,[],'nothing is sent');assert.ok((await f.getByRole('alert').allInnerTexts()).join(' ').match(/crawl depth/i),'depth message');assert.ok((await f.getByRole('alert').allInnerTexts()).join(' ').match(/crawl pages/i),'pages message');await shot2(f,'desktop-datasets-create-numbers.png');
 });
 await check('dataset API: negative and absurd crawl limits are refused by the server',async()=>{
  for(const body of [{max_crawl_depth:-5},{max_crawl_pages:99999999},{max_crawl_depth:1.5},{max_crawl_pages:0},{max_crawl_depth:'3; DROP'}]){const response=await request(`${knowledge}/datasets`,{token,body:{name:'Bad',url:'https://example.test',...body},raw:true});assert.equal(response.status,400,JSON.stringify(body));}
  const fine=await request(`${knowledge}/datasets`,{token,body:{name:'Fine',url:'https://example.test',max_crawl_depth:100,max_crawl_pages:1000},raw:true});assert.equal(fine.status,201);
  const id=(await fine.json()).id;assert.equal((await request(`${knowledge}/datasets/${id}`,{token,method:'PUT',body:{name:'Fine',url:'https://example.test',max_crawl_depth:-1,max_crawl_pages:10},raw:true})).status,400);
 });
 await check('contact form: an empty contact is refused in the browser and by the server',async()=>{
  formPosts.length=0;await f.goto(`${base}/contacts/create`);await f.getByRole('button',{name:'Create'}).click();
  assert.deepEqual(formPosts,[],'nothing is sent');assert.match((await f.getByRole('alert').allInnerTexts()).join(' '),/name|email|external/i);await shot2(f,'desktop-contact-create-empty.png');
  assert.equal((await request(`${api}/contacts`,{token,body:{},raw:true})).status,400);assert.equal((await request(`${api}/contacts`,{token,body:{name:'  ',email:''},raw:true})).status,400);
  assert.equal((await request(`${api}/contacts`,{token,body:{external_id:'crm-1'},raw:true})).status,201);
  const customer=await make('contacts',{name:'Maya Chen',email:'maya@customer.example'});
  for(const width of [1440,390]){
   await f.setViewportSize({width,height:900});await f.goto(`${base}/contacts/${customer.id}`);
   const phone=`+1 555 ${width}`;await f.getByLabel('Phone',{exact:true}).fill(phone);
   const put=f.waitForRequest(r=>r.method()==='PUT'&&new URL(r.url()).pathname===`${api}/contacts/${customer.id}`);
   const saved=f.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname===`${api}/contacts/${customer.id}`);
   await f.getByRole('button',{name:'Save',exact:true}).click();assert.deepEqual(JSON.parse((await put).postData()),{phone});assert.equal((await saved).status(),200);
   await f.getByRole('status').waitFor();
   await shot2(f,`contact-phone-saved-${width}.png`);
   const preference=`maya-preferred-${width}@customer.example`;await f.getByLabel('Provided email',{exact:true}).fill(preference);
   const preferred=f.waitForRequest(r=>r.method()==='PUT'&&new URL(r.url()).pathname===`${api}/contacts/${customer.id}`);
   const preferredSaved=f.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname===`${api}/contacts/${customer.id}`);
   await f.getByRole('button',{name:'Save',exact:true}).click();assert.deepEqual(JSON.parse((await preferred).postData()),{provided_email:preference});assert.equal((await preferredSaved).status(),200);
   await f.reload();await f.getByLabel('Provided email',{exact:true}).waitFor();assert.equal(await f.getByLabel('Provided email',{exact:true}).inputValue(),preference);assert.equal(await f.getByLabel('Phone',{exact:true}).inputValue(),phone);
   await shot2(f,`contact-preference-reloaded-${width}.png`);
  }
 });
 await check('plugin form: non-https URLs are refused before any request',async()=>{
  formPosts.length=0;await f.goto(`${base}/plugins/create`);await f.getByLabel('Name',{exact:true}).fill('Bad');await f.getByLabel('URL',{exact:true}).fill('javascript:alert(1)');await f.getByRole('button',{name:'Add'}).click();
  assert.deepEqual(formPosts,[]);assert.match((await f.getByRole('alert').allInnerTexts()).join(' '),/https/i);
 });
 await forms.close();
 // Agents: the last owner is protected, and removing yourself is clearly warned.
 await check('agent: self-removal is warned and the last owner is protected',async()=>{
  const owners=(await request(`${api}/agents`,{token})).data.filter(row=>row.role==='owner');assert.equal(owners.length,2);
  const me=owners.find(row=>row.email===owner.email);deletes.length=0;
  await page.goto(`${base}/agents/${me.id}`);const trigger=page.getByRole('button',{name:'Delete',exact:true});await trigger.waitFor();await trigger.click();
  const dialog=page.getByRole('dialog');await dialog.waitFor({timeout:3000});assert.match(await dialog.innerText(),/yourself|your own|you will lose access/i,'self-removal is warned');
  await shot('desktop-agent-self-confirm.png');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(deletes,[]);
  // Demote the second owner so the signed-in owner is the sole owner: removing the last owner is blocked up front.
  await request(`${api}/agents/${second.id}`,{token,method:'PUT',body:{role:'operator'}});
  await page.goto(`${base}/agents/${me.id}`);await trigger.waitFor();
  const blocked=await trigger.isDisabled();if(!blocked){await trigger.click();await dialog.waitFor();assert.match(await dialog.innerText(),/last owner/i);}
  else assert.match(await page.locator('main, .main-content, body').first().innerText(),/last owner/i);
  assert.deepEqual(deletes,[],'sole owner is never sent for deletion');
  await shot('desktop-agent-last-owner.png');
 });


 await check('complete directories: paging, supplied identity, conversation links and saved reply body search at desktop and phone',async()=>{
  const actor=(await request('/api/management/bootstrap',{token})).currentAgent.id;
  const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
  const rows=Array.from({length:211},(_,i)=>({suffix:String(i).padStart(3,'0'),seen:i+1}));
  await runtime.execute(rows.map(({suffix,seen})=>`INSERT INTO contacts(id,project_id,name,email,metadata_json,created_at) VALUES('archive-contact-${suffix}',${quote(projectId)},'Archive contact ${suffix}','archive${suffix}@example.test',${quote(JSON.stringify({provided_name:suffix==='210'?'Supplied archive name':null,provided_email:suffix==='210'?'supplied-archive@example.test':null,last_seen_at:seen,country_name:seen%2?'Australia':'Canada'}))},1); INSERT INTO macros VALUES('archive-reply-${suffix}',${quote(projectId)},'Archive reply ${suffix}',${quote(suffix==='210'?'Distinctive body phrase for the older saved reply.':'Reusable archive reply.')},${quote(actor)},${seen},${seen});`).join('\n')+Array.from({length:55},(_,i)=>`INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES('archive-thread-${String(i).padStart(3,'0')}',${quote(projectId)},'archive-contact-210',1,${i+1});`).join('\n'));
  await runtime.execute([1440,390].map(width=>`INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES('archive-picker-${width}',${quote(projectId)},'archive-contact-210',1,0);`).join('\n'));
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   await page.goto(`${base}/contacts`);await page.getByLabel('Sort by',{exact:true}).selectOption('name');await page.getByLabel('Sort direction').selectOption('asc');
   await page.getByRole('link',{name:'Archive contact 000',exact:true}).waitFor();
   const pages=page.getByRole('navigation',{name:'Contact pages',exact:true});
   for(let next=0;next<4;next++){await pages.getByRole('button',{name:'Next',exact:true}).click();await page.getByRole('link',{name:`Archive contact ${String((next+1)*50).padStart(3,'0')}`,exact:true}).waitFor();}
   await page.getByRole('link',{name:'Supplied archive name',exact:true}).waitFor();
   for(const term of ['archive210@example.test','Supplied archive name','supplied-archive@example.test']){await page.getByRole('textbox',{name:'Search',exact:true}).fill(term);await page.getByRole('link',{name:'Supplied archive name',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===1);}
   await page.getByRole('link',{name:'Supplied archive name',exact:true}).click();
   const conversationPages=page.getByRole('navigation',{name:'Conversation pages',exact:true});await conversationPages.getByRole('button',{name:'Next',exact:true}).click();
   const oldest=page.locator('a[href$="/conversations/archive-thread-000"]');await oldest.waitFor();await oldest.click();await page.getByRole('textbox',{name:'Reply to conversation',exact:true}).waitFor();
   await page.goto(`${base}/macros`);await page.getByRole('link',{name:'Archive reply 000',exact:true}).waitFor();
   const replyPages=page.getByRole('navigation',{name:'Saved reply pages',exact:true});
   for(let next=0;next<4;next++){await replyPages.getByRole('button',{name:'Next',exact:true}).click();await page.getByRole('link',{name:`Archive reply ${String((next+1)*50).padStart(3,'0')}`,exact:true}).waitFor();}
   await page.getByRole('link',{name:'Archive reply 210',exact:true}).waitFor();
   await page.getByRole('textbox',{name:'Search',exact:true}).fill('Distinctive body phrase');await page.getByRole('link',{name:'Archive reply 210',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===1);
   await page.getByLabel('Sort by',{exact:true}).selectOption('created_at');await page.getByLabel('Sort direction').selectOption('desc');await page.getByRole('link',{name:'Archive reply 210',exact:true}).waitFor();
   await page.screenshot({path:join(evidenceDir,`complete-library-${width}.png`),fullPage:true});
   await page.goto(`${base}/conversations/archive-picker-${width}`);const composer=page.getByRole('textbox',{name:'Reply to conversation',exact:true});await composer.waitFor();
   await page.getByRole('button',{name:'Reply tools',exact:true}).click();await page.getByRole('menuitem',{name:'Saved replies',exact:true}).click();
   const pickerPages=page.getByRole('navigation',{name:'Saved reply picker pages',exact:true});await page.getByRole('link',{name:'Archive reply 000',exact:true}).waitFor();
   for(let next=0;next<4;next++){await pickerPages.getByRole('button',{name:'Next',exact:true}).click();await page.getByRole('link',{name:`Archive reply ${String((next+1)*50).padStart(3,'0')}`,exact:true}).waitFor();}
   await page.getByRole('link',{name:'Archive reply 210',exact:true}).waitFor();await page.getByRole('searchbox',{name:'Search saved replies',exact:true}).fill('Distinctive body phrase');
   const reply=page.getByRole('link',{name:'Archive reply 210',exact:true});await reply.waitFor();const draftBox=await composer.boundingBox();assert.ok(draftBox.x>=0&&draftBox.x+draftBox.width<=width&&draftBox.y>=0&&draftBox.y+draftBox.height<=1000,'the draft remains visible while searching saved replies');await reply.click();await reply.waitFor({state:'hidden'});assert.equal(await composer.inputValue(),'Distinctive body phrase for the older saved reply.');
   await page.getByRole('button',{name:'Send',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('[aria-label="Reply to conversation"]')?.value==='');
  }
 },page);
 await context.close();
 assert.deepEqual(pageErrors,[],'no page errors');
 await writeFile(join(evidenceDir,'result.json'),JSON.stringify({passed:results,failed:failures},null,2));
 if(failures.length){console.error(`Management library browser FAILED: ${failures.length} of ${results.length+failures.length}\n- ${failures.map(f=>`${f.name}: ${f.message}`).join('\n- ')}`);throw new Error(`Management library browser failed: ${failures.map(f=>f.name).join('; ')}`)}
 else{console.log(`Management library browser passed: ${results.length} checks.`);success=true;}
}finally{await browser?.close();await runtime.close(success);}
async function shot2(page,name){await page.screenshot({path:join(evidenceDir,name),fullPage:true});}

}
