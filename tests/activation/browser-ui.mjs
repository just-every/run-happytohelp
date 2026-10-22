import assert from 'node:assert/strict';
import {axeChecklist,axeInboxStart,capture,noOverflow,visibleControl} from './browser-kit.mjs';

export async function freshViews({page,runtime,projectId,evidence,artifacts,checks}){
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1000});
  // The empty inbox sends the owner to Setup by a link and sends nothing to the activation routes itself.
  const activationCalls=[];const watch=r=>{if(/^\/api\/management\/projects\/[^/]+\/activation/.test(new URL(r.url()).pathname))activationCalls.push(r.url())};
  page.on('request',watch);await page.goto(`${runtime.origin}/projects/${projectId}/conversations`);
  const start=page.locator('[data-testid="inbox-start"]:visible');await start.waitFor();await page.waitForTimeout(2500);page.off('request',watch);
  assert.equal(await start.count(),1,'conversations: one visible start block');
  assert.equal(await page.locator('[data-testid="setup-list"]').count(),0,'conversations: no setup list in the inbox');
  assert.deepEqual(activationCalls,[],'conversations: the empty inbox sends no activation request');
  await noOverflow(page,`${width} conversations`);await axeInboxStart(page,evidence,`${width}-conversations`);await capture(page,evidence,`${width}-conversations-fresh`,artifacts);
  await page.goto(`${runtime.origin}/projects/${projectId}/activation`);
  // Opening the page asks for its own automatic check; confirmed rows are exactly the observed ones.
  const first=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/activation/check')&&r.request().method()==='POST');
  await page.goto(`${runtime.origin}/projects/${projectId}/activation`);
  const root=page.locator('[data-testid="setup-list"]:visible');await root.waitFor();
  assert.equal(await root.count(),1,'activation: one visible setup list');
  assert.equal((await (await first).request().postDataJSON()).auto,true,'activation: the page asks for its own automatic check');
  await root.locator('[role="status"] time').waitFor();
  assert.equal(await root.locator('[data-set][data-state="confirmed"]').count(),Number(await root.getAttribute('data-confirmed')),'activation: confirmed rows match the confirmed count');
  await noOverflow(page,`${width} activation`);await axeChecklist(page,evidence,`${width}-activation`);await capture(page,evidence,`${width}-activation-fresh`,artifacts);
 }
 checks.push('fresh synthetic owner: the empty inbox shows its start block and no setup list (no activation request) and the full Setup page observes by itself at 1440/390; axe serious/critical zero');
}
export async function knowledgeViews({page,runtime,projectId,evidence,artifacts,checks}){
 const base=`${runtime.origin}/projects/${projectId}`;
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1000});
  await page.goto(base+'/articles');await page.getByRole('heading',{name:'Knowledge',exact:true}).waitFor();
  const nav=page.getByRole('navigation',{name:'Main navigation',exact:true});
  if(width===390)await nav.getByRole('button',{name:'Toggle navigation'}).click();
  assert.equal(await nav.getByRole('link',{name:'Knowledge',exact:true}).count(),1);
  assert.ok(await nav.getByRole('link',{name:'Knowledge',exact:true}).isVisible(),'primary knowledge link is visible');
  // AI and Local computers configure the workspace: they are in the Settings menu, which the rail becomes on a Settings page.
  await nav.getByTestId('nav-settings').click();await page.waitForURL(`${base}/edit`);await page.getByRole('heading',{name:'Project',exact:true}).waitFor();
  if(width===390)await nav.getByRole('button',{name:'Toggle navigation'}).click();
  const settingsMenu=nav.getByTestId('settings-menu');
  assert.ok(await settingsMenu.getByRole('link',{name:'AI',exact:true}).isVisible(),'AI is reachable in Settings');
  assert.ok(await settingsMenu.getByRole('link',{name:'Local computers',exact:true}).isVisible(),'Local computers is reachable in Settings');
  await page.goto(base+'/articles');const draftRow=page.getByRole('row').filter({hasText:'Activation draft again'});await draftRow.getByText('Not used by AI answers',{exact:true}).waitFor();assert.match(await page.locator('body').innerText(),/Used by AI answers/i);assert.match((await draftRow.innerText()).replace('Activation draft again',''),/\bdraft\b|not used|\bno\b/i,'draft source is explicitly ineligible');await noOverflow(page,'Knowledge');
  await page.goto(base+'/articles/create');await page.getByRole('heading',{name:'New article',exact:true}).waitFor();
  await page.getByLabel('Title',{exact:true}).fill(`Long activation article ${width}`);await page.getByLabel('Summary',{exact:true}).fill('Long article checks persistent actions.');
  const content=page.getByRole('textbox',{name:'Article content in Markdown',exact:true});await content.fill(Array.from({length:90},(_,i)=>`Paragraph ${i}: preserve editor actions while reading a long article.`).join('\n\n'));
  for(const position of ['top','bottom']){
   await page.evaluate(position=>{const element=document.querySelector('#workspace-main');element?.scrollTo(0,position==='top'?0:element.scrollHeight);window.scrollTo(0,position==='top'?0:document.body.scrollHeight)},position);
   await visibleControl(page.getByRole('button',{name:'Save',exact:true}),`${width} new Save ${position}`);await visibleControl(page.getByRole('button',{name:'Publish',exact:true}),`${width} new Publish ${position}`);
  }
  const published=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/knowledge/${projectId}/articles`&&r.request().method()==='POST');await page.getByRole('button',{name:'Publish',exact:true}).click();assert.equal((await published).status(),201);
  await page.getByRole('heading',{name:'Edit article',exact:true}).waitFor();await page.reload();await page.getByRole('heading',{name:'Edit article',exact:true}).waitFor();
  // The editor renders before the saved record arrives; the status naming it Published is that record.
  await page.getByRole('group',{name:'Article save and publish',exact:true}).getByRole('status').filter({hasText:'Published'}).waitFor();
  await page.evaluate(()=>{const element=document.querySelector('#workspace-main');element?.scrollTo(0,element.scrollHeight);window.scrollTo(0,document.body.scrollHeight)});
  await visibleControl(page.getByRole('button',{name:'Save',exact:true}),`${width} edit Save`);
  assert.equal(await page.getByRole('button',{name:'Publish',exact:true}).count(),0,`${width} a published article offers no second Publish`);
  const saved=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/knowledge/${projectId}/articles`&&response.request().method()==='POST');await page.getByRole('button',{name:'Save',exact:true}).click();assert.equal((await saved).status(),201);await noOverflow(page,'article editor');await capture(page,evidence,`${width}-article-actions`,artifacts);
 }
 checks.push('one primary Knowledge navigation, AI and Local computers in the Settings menu, source status and long new article Save/Publish and published-article Save at both widths');
}
export async function demoAndAiViews({page,runtime,projectId,evidence,artifacts,checks}){
 const base=`${runtime.origin}/projects/${projectId}`;await page.goto(base+'/conversations');await page.getByRole('button',{name:'Try a demo inbox',exact:true}).click();await page.waitForURL(/\/projects\/demo-[^/]+\/conversations/);const demoId=new URL(page.url()).pathname.split('/')[2];
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1000});await page.goto(`${runtime.origin}/projects/${demoId}/articles`);await page.getByText('Back to your workspace',{exact:true}).waitFor();await page.getByText('Used by AI answers',{exact:true}).first().waitFor();assert.match(await page.locator('body').innerText(),/Demo/i);assert.match(await page.locator('body').innerText(),/Used by AI answers/i);
  await page.reload();await page.getByText('Back to your workspace',{exact:true}).waitFor();await page.goto(`${runtime.origin}/projects/${demoId}/conversations?view=open`);
  await page.locator('.conversation-list-items').getByText('Maya Chen (demo)',{exact:true}).click();
  const trigger=page.locator('.conversation-assistant-toggle');await trigger.waitFor();assert.match(await trigger.getAttribute('aria-label'),/^(Show|Hide) conversation panel$/);if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();
  const ai=page.getByRole('tab',{name:'Suggest',exact:true});await ai.waitFor();await ai.click();assert.equal(await page.getByRole('button',{name:/^Generate(?: replies)?$/}).count(),1,'one Generate');assert.equal(await page.getByRole('tab',{name:'Delegate',exact:true}).count(),1,'one Delegate');assert.equal(await page.getByRole('button',{name:'Delegate',exact:true}).count(),0,'no duplicate header Delegate');
  if(width===390){assert.ok(await ai.evaluate(element=>element===document.activeElement),'Suggest tab receives focus');await page.keyboard.press('ArrowRight');assert.ok(await page.getByRole('tab',{name:'Delegate',exact:true}).evaluate(element=>element===document.activeElement));await page.keyboard.press('ArrowLeft');}
  page.expectedProviderFailure=true;await page.getByRole('button',{name:/^Generate(?: replies)?$/}).click();await page.getByText(/OPENAI_API_KEY|ANTHROPIC_API_KEY|installation secret/i).first().waitFor();assert.match(await page.locator('body').innerText(),/secret|key/i);page.expectedProviderFailure=false;
  await noOverflow(page,'AI panel');await capture(page,evidence,`${width}-demo-ai`,artifacts);
  if(width===390){await page.keyboard.press('Escape');assert.ok(await trigger.evaluate(element=>element===document.activeElement),'focus restored to AI entry');}
 }
 await page.getByText('Back to your workspace',{exact:true}).click();await page.waitForURL(`**/projects/${projectId}/conversations`);assert.equal(await page.getByText('Back to your workspace',{exact:true}).count(),0);
 checks.push('persistent demo cross-page banner and real return, single Generate/Local, missing key guidance, mobile tab/focus/Escape');
}
