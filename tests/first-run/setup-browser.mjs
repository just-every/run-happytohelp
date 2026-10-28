import assert from 'node:assert/strict';
import {audit,firstOwner,post} from './browser-kit.mjs';
import {declaredSignIn} from './sign-in-entry.mjs';

const order=async list=>list.locator('> [data-section]').evaluateAll(nodes=>nodes.map(node=>node.dataset.section));
const needIds=async list=>list.locator('[data-need]').evaluateAll(nodes=>nodes.map(node=>node.dataset.need));
const counts=async list=>({confirmed:Number(await list.getAttribute('data-confirmed')),applicable:Number(await list.getAttribute('data-applicable'))});
const skippedIds=async list=>list.locator('[data-skipped]').evaluateAll(nodes=>nodes.map(node=>node.dataset.skipped));
const shape=async(page,list)=>({heading:await page.locator('h1 [data-setup-state]').getAttribute('data-setup-state'),order:await order(list),needs:await needIds(list),skipped:await skippedIds(list),counts:await counts(list)});
// Press a skip, undo or try-locally control and wait for the server's answer to be on the page (the controls are disabled until then).
const press=async(page,locator,route='skip')=>{const answered=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/activation/'+route)&&r.request().method()==='POST');await locator.click();assert.equal((await answered).status(),200);await page.waitForFunction(()=>!document.querySelector('[data-testid="setup-list"] button[data-skip][disabled],[data-testid="setup-list"] button[data-undo][disabled]'))};

/** Skip for now: leave a step, see it under Skipped with Undo, the counts and heading follow, it lasts a reload, and Undo returns it in place.
 *  Then try locally: one request leaves both steps for now and reaches the same state as the two skips. */
async function skipFlow({page,list,evidence,width}){
 // Skip joins an in-flight automatic check. Sample its baseline only after that observation is rendered.
 await page.waitForFunction(()=>document.querySelector('[data-testid="setup-list"] [data-again]')?.disabled===false);
 const before=await counts(list),heading=page.locator('h1 [data-setup-state]');
 assert.equal(await heading.getAttribute('data-setup-state'),'needs-you');
 await press(page,list.locator('[data-need="model_key"] button[data-skip]'));
 assert.deepEqual(await order(list),['optional','skipped','set']);
 assert.deepEqual(await needIds(list),['widget_seen']);
 assert.deepEqual(await skippedIds(list),['model_key']);
 const row=list.locator('[data-skipped="model_key"]');await row.waitFor();
 assert.equal(await row.locator('button[data-undo]').count(),1);assert.ok((await row.locator('[data-field="label"]').innerText()).trim().length>0);
 assert.equal(await row.locator('[data-state="confirmed"],.fe-check').count(),0,'a skipped item is never shown as confirmed');
 assert.deepEqual(await counts(list),{confirmed:before.confirmed,applicable:before.applicable-1},'a skip leaves the count and confirms nothing');
 assert.equal(await list.locator('[data-count]').count(),0,'an optional step is never counted as needing the owner');
 assert.equal(await heading.getAttribute('data-setup-state'),'needs-you','an open optional step keeps the heading at Nearly ready');
 await audit(page,evidence,`${width}-skipped-ai`);
 await press(page,list.locator('[data-need="widget_seen"] button[data-skip]'));
 assert.deepEqual(await needIds(list),[]);assert.equal(await list.locator('[data-empty]').count(),1,'nothing needs the owner');
 assert.equal(await heading.getAttribute('data-setup-state'),'ready','skipped items do not keep the heading at Nearly ready');
 assert.equal(await heading.innerText(),await heading.innerText());
 assert.deepEqual(await skippedIds(list),['widget_seen','model_key'],'skipped items keep the need order');
 const bothSkipped=await shape(page,list);
 await audit(page,evidence,`${width}-everything-skipped`);
 // Held by the server for the workspace, not by this browser.
 await page.reload();await page.locator('[data-testid="setup-list"][data-applicable]').waitFor();
 assert.deepEqual(await order(list),['needs-you','skipped','set']);assert.equal(await list.locator('[data-skipped]').count(),2);
 assert.equal(await page.locator('h1 [data-setup-state]').getAttribute('data-setup-state'),'ready');
 assert.deepEqual(await page.evaluate(()=>[...Object.entries(localStorage),...Object.entries(sessionStorage)].filter(([key,value])=>/skip/i.test(key+value))),[],'nothing about skips is kept in the browser');
 await press(page,list.locator('[data-skipped="model_key"] button[data-undo]'));await press(page,list.locator('[data-skipped="widget_seen"] button[data-undo]'));
 assert.deepEqual(await needIds(list),['widget_seen','model_key'],'undo returns each need to its place');
 assert.deepEqual(await order(list),['optional','set']);assert.deepEqual(await counts(list),before);
 assert.equal(await page.locator('h1 [data-setup-state]').getAttribute('data-setup-state'),'needs-you');
 // Try locally without a website or AI key: one request, the state the two skips reached, and Undo still returns both.
 const writes=[],write=request=>{const path=new URL(request.url()).pathname;if(request.method()==='POST'&&/\/activation\/(skip|local-trial)$/.test(path))writes.push(path.split('/').pop())};
 page.on('request',write);await press(page,list.locator('button[data-local-trial]'),'local-trial');page.off('request',write);
 assert.deepEqual(writes,['local-trial'],'trying locally is one request');
 assert.deepEqual(await shape(page,list),bothSkipped,'trying locally reaches the state the two skips reach');
 assert.equal(await list.locator('button[data-local-trial]').count(),0,'nothing is left to try without');
 await audit(page,evidence,`${width}-tried-locally`);
 await press(page,list.locator('[data-skipped="model_key"] button[data-undo]'));await press(page,list.locator('[data-skipped="widget_seen"] button[data-undo]'));
 assert.deepEqual(await counts(list),before);
}

export async function setupJourney({browser,runtime,width,evidence,password,email}){
 const context=await browser.newContext({viewport:{width,height:844},bypassCSP:true}),page=await context.newPage();
 try{
  const projectId=await firstOwner(page,runtime.origin,{email,password,width});
  const list=page.getByTestId('setup-list');await page.locator('[data-testid="setup-list"][data-applicable]').waitFor();
  assert.equal(await list.getAttribute('data-environment'),'local');
  assert.equal(await list.locator('button[data-local-trial]').count(),1,'a local install offers to try it locally in one step');
  assert.equal(await page.getByRole('heading',{level:1}).count(),1);
  // Structure, not wording: with no website of the owner's own, the widget and the AI service wait under Optional, then
  // What we've set; every step has one heading, a status and the way to skip it.
  assert.deepEqual(await list.locator('> [data-section]').evaluateAll(nodes=>nodes.map(node=>node.dataset.section)),['optional','set']);
  assert.deepEqual(await list.locator('[data-need]').evaluateAll(nodes=>nodes.map(node=>node.dataset.need)),['widget_seen','model_key']);
  assert.equal(await page.locator('[data-need="published_article"],[data-set="published_article"]').count(),0,'no help-article item or row');
  for(const need of await list.locator('[data-need]').all()){
   assert.equal(await need.getByRole('heading',{level:3}).count(),1);
   assert.equal(await need.locator('button[data-skip]').count(),1,'every need can be skipped');
   assert.match(await need.locator('[data-status]').getAttribute('data-status'),/^(waiting|checking|problem|review)$/);
   assert.ok((await need.locator('[data-status]').innerText()).trim().length>0);
  }
  assert.equal(await list.locator('[data-count]').count(),0,'optional steps are not counted as needing the owner');
  const rows=await list.locator('[data-set]').evaluateAll(nodes=>nodes.map(node=>node.dataset.set));
  for(const id of ['workspace','widget_origin','owner_mail','spend_ceilings'])assert.ok(rows.includes(id),`${id} is listed under What we have set`);
  for(const row of await list.locator('[data-set]').all()){assert.equal(await row.locator('a[data-field="change"]').count(),1);assert.ok((await row.locator('[data-field="value"]').innerText()).trim().length>0);}
  // The page observes for itself: no per-row or setup-wide check button, one quiet footer control, nothing that sends mail.
  assert.equal(await list.getByRole('button',{name:/^Check (?!again)|test mail/i}).count(),0);
  assert.equal(await list.locator('[data-again]').count(),1);
  assert.doesNotMatch(await list.innerText(),/Not needed for a local trial/);
  await audit(page,evidence,`${width}-first-owner-setup-list`);
  await skipFlow({page,list,evidence,width});
  await page.context().clearCookies();
  await declaredSignIn({page,origin:runtime.origin,email,password,width,evidence,projectId});
  await audit(page,evidence,`${width}-existing-owner-setup-list`);
  const login=await post(runtime.origin,'/api/identity/login',{email,password});
  for(const section of ['activation','widget-settings','articles','reports','contacts','api-settings','webhook-settings','slack-settings','delivery-log','conversations']){
   await page.goto(runtime.origin+`/projects/${projectId}/${section}`);
   await page.locator(`button[aria-label="Switch workspace: Local support ${width}"]`).waitFor({state:'attached'});
   if(section==='conversations'){
    await page.getByTestId('inbox-primary-action').waitFor();
    assert.match(await page.getByTestId('inbox-primary-action').getAttribute('href'),/\/widget-settings$/);
    assert.match(await page.getByTestId('inbox-setup-link').getAttribute('href'),/\/activation$/);
    assert.equal(await page.getByRole('button',{name:'Try a demo inbox',exact:true}).count(),1);
    assert.equal(await page.getByTestId('setup-list').count(),0,'the empty inbox does not repeat the Setup list');
    await audit(page,evidence,`${width}-empty-inbox-actions`);
   }
  }
  await page.goto(runtime.origin+'/projects/create');await page.getByLabel('Name',{exact:true}).fill('Second workspace '+width);
  await page.getByLabel('Website',{exact:true}).fill(runtime.origin);await page.getByLabel('Widget website origin',{exact:true}).fill(runtime.origin);
  await page.getByRole('button',{name:'Create project',exact:true}).click();await page.waitForURL(/\/widget-settings$/);
  const secondId=new URL(page.url()).pathname.split('/')[2];assert.notEqual(secondId,projectId);
  await page.locator(`button[aria-label="Switch workspace: Second workspace ${width}"]`).waitFor({state:'attached'});
  const snippet=page.getByRole('heading',{name:'Install the widget',exact:false});await snippet.waitFor();
  assert.equal(await page.getByRole('button',{name:'Reveal server secret'}).isVisible(),false);
  assert.equal(await page.locator('.widget-code__advanced').getAttribute('open'),null);
  const order=await page.locator('.widget-code').evaluate(root=>[...root.querySelectorAll('section,details')].map(node=>node.getAttribute('aria-labelledby')||node.className));
  assert.equal(order[0],'widget-code-install-heading');
  const code=page.locator('.widget-code__snippet pre').first();
  assert.equal(await code.getAttribute('tabindex'),'0','scrollable code is keyboard reachable');
  await code.focus();assert.equal(await code.evaluate(element=>element===document.activeElement),true);
  await audit(page,evidence,`${width}-new-workspace-snippet`);
  await page.locator('.widget-code__advanced > summary').click();await page.getByRole('button',{name:'Reveal server secret'}).waitFor();
  assert.equal(await page.getByRole('tablist',{name:'Verification example language'}).getByRole('tab').count(),6);
  assert.equal(await page.locator('#widget-code-verification-example').isVisible(),true);
  assert.match(await page.locator('#widget-code-verification-example').innerText(),/hash_hmac/);
  await audit(page,evidence,`${width}-advanced-masked`);
  const navigation=page.getByRole('navigation',{name:'Main navigation'});
  await navigation.getByRole('button',{name:/Switch workspace:/}).click();
  await navigation.getByRole('button',{name:'Local support '+width,exact:true}).click();
  await page.locator(`button[aria-label="Switch workspace: Local support ${width}"]`).waitFor({state:'attached'});
  assert.ok(new URL(page.url()).pathname.startsWith(`/projects/${projectId}/`));
  await audit(page,evidence,`${width}-workspace-switched`);
  await page.goto(runtime.origin+'/setup');assert.equal(await page.getByRole('button',{name:'Create workspace',exact:true}).count(),0);
  return {projectId,token:login.token};
 }finally{await context.close();}
}
