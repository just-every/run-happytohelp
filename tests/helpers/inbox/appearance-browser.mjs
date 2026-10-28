import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRuntime} from '../emitted-runtime.mjs';
import {assertHelpSearchFits,assertHelpSearchReachable} from '../appearance-geometry.mjs';
import {assertHelpLinksReadable} from '../help-center-link-contrast.mjs';
import {exerciseLongAppearance} from '../appearance-long-content.mjs';
import {appearanceAudit} from '../appearance-audit.mjs';
import {settingsTargetsBrowser} from './settings-targets-browser.mjs';
import {launchBrowser} from '../../journeys/kit/browser.mjs'

export async function appearanceBrowser(){
const directory=resolve(process.env.H2H_EVIDENCE_DIR||'test-results/appearance');await mkdir(directory,{recursive:true});
const runtime=await createRuntime(),origin=runtime.origin,records=[];let browser,success=false;
const api=async(path,{token,body,method=body?'POST':'GET'}={})=>{const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return response};
const brand={brand_name:'Orchid Support',logo_url:origin+'/site-assets/images/happytohelp-logo.png',avatar_url:origin+'/site-assets/images/happytohelp-logo.png',welcome_message:'Welcome to Orchid. How can we help?',primary_color:'#204b3a'};
// Use an actual bundled image; no generated/mocked application content.
brand.logo_url=brand.avatar_url=origin+'/homepage/media/brands/happytohelp-favicon.png';
const audit=appearanceAudit(directory,records);
try{
 browser=await launchBrowser();
 const tenant=await runtime.seedTenant({name:'Orchid',email:'orchid@example.test',allowedOrigin:origin}),other=await runtime.seedTenant({name:'Other tenant',email:'other@example.test',allowedOrigin:origin});
 const settingsPath=`/api/management/projects/${tenant.projectId}/settings`,widgetPath=`/api/management/projects/${tenant.projectId}/widget-settings`;
 const project=await(await api(`/api/identity/projects/${tenant.projectId}`,{token:tenant.token})).json();
 const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(15000);await context.addCookies([{name:'h2h_session',value:tenant.token,url:origin}]);
 await page.goto(origin+`/projects/${tenant.projectId}/edit`);await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByText('Additional branding',{exact:true}).click();
 for(const [label,value] of [['Public brand name',brand.brand_name],['Logo URL',brand.logo_url],['Support avatar URL',brand.avatar_url],['Welcome greeting',brand.welcome_message]])await page.getByLabel(label,{exact:true}).fill(value);
 await page.getByLabel('Workspace color hex').fill(brand.primary_color);await page.getByRole('button',{name:'Update',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();await page.reload();
 await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByText('Additional branding',{exact:true}).click();assert.equal(await page.getByLabel('Welcome greeting',{exact:true}).inputValue(),brand.welcome_message);
 const modes=page.getByRole('group',{name:'Display mode'});
 const assertSelectedMode=async name=>{
  const selected=modes.getByRole('button',{name,exact:true});
  assert.equal(await selected.getAttribute('aria-pressed'),'true');
  const state=await selected.evaluate(button=>{const s=getComputedStyle(button),body=getComputedStyle(document.body);return {color:s.color,background:s.backgroundColor,ink:body.getPropertyValue('--ink').trim(),tint:body.getPropertyValue('--d-cyan-tint').trim()}});
  const rgb=hex=>'rgb('+hex.slice(1).match(/../g).map(v=>parseInt(v,16)).join(', ')+')';
  assert.equal(state.color,rgb(state.ink),'selected mode reads in the brand ink');
  assert.equal(state.background,rgb(state.tint),'selected mode sits on the brand aqua tint');
  for(const other of ['Balanced','Light','Dark'].filter(mode=>mode!==name))assert.equal(await modes.getByRole('button',{name:other,exact:true}).getAttribute('aria-pressed'),'false');
 };
 await assertSelectedMode('Balanced');
 for(const name of ['Light','Dark','Balanced']){
  await modes.getByRole('button',{name,exact:true}).click();await assertSelectedMode(name);
  await page.getByRole('button',{name:'Update',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();await page.reload();
  await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByText('Additional branding',{exact:true}).click();
  assert.equal(await page.getByLabel('Workspace color hex').inputValue(),brand.primary_color);await assertSelectedMode(name);
  assert.equal(await page.evaluate(()=>document.body.dataset.theme),name==='Dark'?'dark':'light','the saved display mode renders the workspace');
 }
 const saved=await(await api(settingsPath,{token:tenant.token})).json();for(const [key,value]of Object.entries(brand))assert.equal((saved.data||saved)[key],value);
 const denied=await api(settingsPath,{token:other.token,method:'PUT',body:{welcome_message:'Tenant leak'}});assert.equal(denied.status,403);
 const second=await(await api(`/api/management/projects/${other.projectId}/settings`,{token:other.token})).json();assert.notEqual((second.data||second).welcome_message,brand.welcome_message);
 await settingsTargetsBrowser({page,origin,tenant,audit});
 const article={title:'Published instructions',slug:'published-instructions',content:'Read the published instructions.',status:'published'};
 let publicArticle;
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  await page.goto(origin+`/projects/${tenant.projectId}/edit`);await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByText('Additional branding',{exact:true}).click();assert.equal(await page.locator('.project-parity-tabs button.active').evaluate(el=>getComputedStyle(el,'::after').backgroundColor),await page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--d-cyan-deep').trim()).then(hex=>'rgb('+hex.slice(1).match(/../g).map(v=>parseInt(v,16)).join(', ')+')'),'the current tab carries the aqua bar');await audit(page,viewport.width+'-appearance-saved');
  // Request delays and transport failures, not fabricated application responses.
  // Keep held routes until the released state and its images are audited.
  // Disabling the last route can drop image requests still paused in interception.
  let release;const held=new Promise(r=>release=r);
  await page.route('**'+widgetPath,async route=>{await held;await route.continue()});
  await page.goto(origin+`/projects/${tenant.projectId}/widget-settings`);await page.getByText('Loading your widget settings and preview…').waitFor();await audit(page,viewport.width+'-settings-loading');release();await page.getByRole('tab',{name:'Theme',exact:true}).waitFor();
  await page.getByRole('tab',{name:'Theme',exact:true}).click();await page.locator('#happytohelp').getByText(brand.welcome_message,{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Send button background',{exact:true}).inputValue(),brand.primary_color);assert.equal(await page.locator('#happytohelp button[name=submit]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(32, 75, 58)');await audit(page,viewport.width+'-settings-preview');await page.unroute('**'+widgetPath);
  await page.route('**'+widgetPath,route=>route.abort('failed'));await page.reload();await page.getByRole('button',{name:'Try again',exact:true}).waitFor();await audit(page,viewport.width+'-settings-error');await page.unroute('**'+widgetPath);await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByRole('tab',{name:'Theme',exact:true}).click();await page.locator('#happytohelp').getByText(brand.welcome_message,{exact:true}).waitFor();await audit(page,viewport.width+'-settings-recovered');
  const visitorContext=await browser.newContext({viewport}),visitor=await visitorContext.newPage();
  const mount=async()=>{await visitor.addScriptTag({url:origin+'/widget.js'});await visitor.evaluate(options=>window.h2h('init',options),{widgetKey:project.widget_key,apiOrigin:origin,open:true,settings:{collector:{enabled:false}}});};
  if(!publicArticle){await visitor.goto(origin+`/help/${tenant.projectId}`);await visitor.getByText('There are no published articles yet.',{exact:false}).waitFor();await assertHelpSearchFits(visitor);await audit(visitor,viewport.width+'-help-empty');}
  else {await api(`/api/knowledge/${tenant.projectId}/articles`,{token:tenant.token,body:{...article,id:publicArticle.id,status:'draft'}});await visitor.goto(origin+`/help/${tenant.projectId}`);await visitor.getByText('There are no published articles yet.',{exact:false}).waitFor();await assertHelpSearchFits(visitor);await audit(visitor,viewport.width+'-help-empty');}
  let releaseWidget;const delayed=new Promise(r=>releaseWidget=r);await visitor.route('**/api/identity/widget/session',async route=>{await delayed;await route.continue()});await mount();await visitor.getByText('Connecting to support…',{exact:true}).waitFor();await audit(visitor,viewport.width+'-widget-loading');releaseWidget();await visitor.locator('.happytohelp-connection-state').waitFor({state:'hidden'});
  await visitor.getByText(brand.welcome_message,{exact:true}).last().waitFor();await visitor.locator('.happytohelp-connection-state').waitFor({state:'hidden'});assert.equal(await visitor.locator('button[name=submit]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(32, 75, 58)');assert.equal(await visitor.locator('.happytohelp-brand-heading img').getAttribute('src'),brand.logo_url);assert.equal(await visitor.locator('.happytohelp-welcome img').getAttribute('src'),brand.avatar_url);await visitor.locator('.happytohelp-welcome').evaluate(el=>{const b=el.getBoundingClientRect(),h=el.getRootNode().querySelector('.happytohelp-chat-header-container').getBoundingClientRect();if(b.top<h.bottom-1||b.bottom>innerHeight)throw Error('Greeting is covered or outside widget')});if(viewport.width===1440)await assertHelpSearchReachable(visitor);await audit(visitor,viewport.width+'-widget-empty');await visitor.unroute('**/api/identity/widget/session');
  await visitorContext.setOffline(true);await visitor.getByText('You’re offline. Your conversation is saved. Reconnect to continue.').waitFor();await audit(visitor,viewport.width+'-widget-offline');await visitorContext.setOffline(false);await visitor.locator('.happytohelp-connection-state').waitFor({state:'hidden'});await audit(visitor,viewport.width+'-widget-recovered');
  await visitor.route('**/api/conversations/*/messages',route=>route.abort('failed'));await visitor.locator('textarea[name=content]').fill('Please help with my account');await visitor.locator('button[name=submit]').click();await visitor.getByText('Connection interrupted. Your conversation is saved.').waitFor();await audit(visitor,viewport.width+'-widget-error');await visitor.unroute('**/api/conversations/*/messages');await visitor.getByRole('button',{name:'Reconnect',exact:true}).click();await visitor.locator('.happytohelp-connection-state').waitFor({state:'hidden'});await audit(visitor,viewport.width+'-widget-error-recovered');
  await visitor.getByRole('button',{name:'Close chat',exact:true}).click();
  const published=await api(`/api/knowledge/${tenant.projectId}/articles`,{token:tenant.token,body:{...article,...(publicArticle?{id:publicArticle.id}:{})}});assert.equal(published.status,201);publicArticle=await published.json();
  await api(`/api/knowledge/${tenant.projectId}/articles`,{token:tenant.token,body:{title:'Hidden draft',slug:'hidden-draft-'+viewport.width,content:'Private content',status:'draft'}});
  for(const [name,path,text]of [['index',`/help/${tenant.projectId}`,'Published instructions'],['article',`/help/${tenant.projectId}/published-instructions`,'Published instructions'],['no-results',`/help/${tenant.projectId}/search?keyword=absent`,'0 results found'],['draft-denied',`/help/${tenant.projectId}/hidden-draft-${viewport.width}`,'Article not found']]){
   const response=await visitor.goto(origin+path);assert.equal(response.status(),name==='draft-denied'?404:200);await visitor.getByText(text,{exact:true}).first().waitFor();await audit(visitor,viewport.width+'-help-'+name);
   if(name==='index'){assert.equal(await visitor.locator('.help-center-nav').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(32, 75, 58)');assert.equal(await visitor.getByRole('link',{name:'Published instructions',exact:true}).evaluate(el=>getComputedStyle(el).color),'rgb(32, 75, 58)');await assertHelpSearchFits(visitor);assert.equal(await visitor.getByRole('link',{name:'Published instructions',exact:true}).getAttribute('href'),`/help/${tenant.projectId}/published-instructions`);assert.equal(await visitor.locator('.help-center-logo').getAttribute('src'),brand.logo_url);assert.equal(await visitor.locator('.help-center-welcome img').getAttribute('src'),brand.avatar_url);}
  }
  await visitor.goto(origin+`/help/${tenant.projectId}`);
  const articleUrl=origin+`/help/${tenant.projectId}/published-instructions`;
  let releaseHelp;const delayedHelp=new Promise(r=>releaseHelp=r);
  await visitor.route(articleUrl,async route=>{await delayedHelp;await route.continue()});
  await visitor.getByRole('link',{name:'Published instructions',exact:true}).click();await visitor.getByText('Loading Help Center…',{exact:true}).waitFor();await audit(visitor,viewport.width+'-help-loading');releaseHelp();await visitor.waitForURL(articleUrl);await audit(visitor,viewport.width+'-help-loaded');await visitor.unroute(articleUrl);
  await visitor.goto(origin+`/help/${tenant.projectId}`);await visitor.route(articleUrl,route=>route.abort('failed'));await visitor.getByRole('link',{name:'Published instructions',exact:true}).click();await visitor.getByText('Help Center could not load. Your last loaded page is still available.',{exact:false}).waitFor();await audit(visitor,viewport.width+'-help-error');await visitor.unroute(articleUrl);await visitor.getByRole('button',{name:'Try again',exact:true}).click();await visitor.waitForURL(articleUrl);await audit(visitor,viewport.width+'-help-error-recovered');
  await visitorContext.setOffline(true);await visitor.getByText('You’re offline. The last loaded page is still available.',{exact:false}).waitFor();await audit(visitor,viewport.width+'-help-offline');await visitorContext.setOffline(false);await visitor.locator('[data-help-status]').waitFor({state:'hidden'});await audit(visitor,viewport.width+'-help-online');
  await visitorContext.close();
 }
 // Light workspace accents retain the navigation brand while body links use a readable tone.
 const contrastArticle=await api(`/api/knowledge/${tenant.projectId}/articles`,{token:tenant.token,body:{title:'Accent contrast guide',slug:'accent-contrast-guide',content:`Read the [published instructions](/help/${tenant.projectId}/published-instructions).`,status:'published'}});
 assert.equal(contrastArticle.status,201);
 const contrastMeasurements=[];
 for(const color of ['#ffffff','#fff3a3']){
  const update=await api(settingsPath,{token:tenant.token,method:'PUT',body:{primary_color:color}});assert.equal(update.status,200);
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   await page.setViewportSize(viewport);
   for(const [name,path]of [['index',`/help/${tenant.projectId}`],['search',`/help/${tenant.projectId}/search?keyword=Accent`],['article',`/help/${tenant.projectId}/accent-contrast-guide`]]){
    assert.equal((await page.goto(origin+path)).status(),200);
    const configuredRgb='rgb('+color.slice(1).match(/../g).map(value=>parseInt(value,16)).join(', ')+')';
    assert.equal(await page.locator('.help-center-nav').evaluate(element=>getComputedStyle(element).backgroundColor),configuredRgb,'navigation retains exact workspace accent');
    contrastMeasurements.push({color,viewport:viewport.width,route:name,links:await assertHelpLinksReadable(page)});
    await audit(page,`${viewport.width}-help-${name}-${color.slice(1)}`);
   }
  }
 }
 await writeFile(join(directory,'help-link-contrast.json'),JSON.stringify(contrastMeasurements,null,2));
 await exerciseLongAppearance({page,browser,origin,tenant,project,api,brand,audit});
 // Removal uses the same native form and restores defaults across both public surfaces.
 await page.goto(origin+`/projects/${tenant.projectId}/edit`);await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByText('Additional branding',{exact:true}).click();
 for(const label of ['Public brand name','Logo URL','Support avatar URL','Welcome greeting'])await page.getByLabel(label,{exact:true}).fill('');await page.getByRole('button',{name:'Reset',exact:true}).click();await page.getByRole('button',{name:'Update',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();
 await page.goto(origin+`/help/${tenant.projectId}`);assert.equal(await page.locator('.help-center-logo,.help-center-welcome').count(),0);await page.getByRole('link',{name:'Orchid Help Center',exact:true}).waitFor();
 await page.goto(origin+`/projects/${tenant.projectId}/widget-settings`);await page.getByRole('tab',{name:'Theme',exact:true}).click();await page.locator('#happytohelp').getByText('Hi! How can we help you today?',{exact:true}).waitFor();assert.equal(await page.locator('#happytohelp .happytohelp-brand-heading img').count(),0);
 await runtime.execute(`UPDATE project_settings SET settings_json=json_set(settings_json,'$.deleted_at',1) WHERE project_id='${tenant.projectId}'`);
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){await page.setViewportSize(viewport);assert.equal((await page.goto(origin+`/help/${tenant.projectId}`)).status(),404);await audit(page,viewport.width+'-help-deleted');}
 success=true;console.log('Appearance PASS: native save/reload/removal/defaults, preview parity, isolation, empty/loading/error/offline/recovery, publication/canonical/draft/deletion, '+records.length+' rendered axe scans.');
}finally{await browser?.close();await runtime.close(success)}

}
