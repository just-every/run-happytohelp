import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRuntime} from '../emitted-runtime.mjs';
import {navigationFixture} from '../navigation-fixture.mjs';
import {launchBrowser} from '../../journeys/kit/browser.mjs'

export async function workspaceShell(){
// Workspace scoping and shell regressions, driven through the real emitted Worker and Chromium.
// Each check runs independently so one failure does not hide the others; the process fails if any did.
const evidence=join(process.env.H2H_EVIDENCE_DIR?resolve(process.env.H2H_EVIDENCE_DIR):await mkdtemp(join(tmpdir(),'h2h-workspace-shell-')),'workspace-shell');
await mkdir(evidence,{recursive:true});
const runtime=await createRuntime({port:Number(process.env.H2H_TEST_PORT||0)});
const browser=await launchBrowser();
const results=[];
const requests=[];
const unknownId='00000000-0000-4000-8000-000000000000';
let page;
const nav=()=>page.getByRole('navigation',{name:'Main navigation'});
const ready=()=>nav().getByRole('button',{name:/Switch workspace:/}).waitFor();
const shot=name=>page.screenshot({path:join(evidence,`${name}.png`)}).catch(()=>{});
const settingsOpen=async()=>{const button=nav().getByRole('button',{name:'Settings',exact:true});if(await button.getAttribute('aria-expanded')!=='true')await button.click();};
// The session is bound to one project; put it on `projectId` the way the workspace switcher does.
const bindSession=(projectId)=>page.evaluate(async id=>{const r=await fetch('/api/identity/switch-project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:id})});if(!r.ok)throw new Error('bind '+r.status)},projectId);
const api=(path)=>page.evaluate(async p=>(await fetch(p)).status,path);
const luminance=([r,g,b])=>{const c=[r,g,b].map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4});return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]};
const contrast=(a,b)=>{const [hi,lo]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (hi+0.05)/(lo+0.05)};
const check=async(name,body)=>{try{await body();results.push({name,ok:true});console.log('ok  -',name)}catch(error){results.push({name,ok:false,error:error.message});console.error('FAIL -',name,'\n     ',String(error.message).split('\n').slice(0,6).join('\n      '));await shot('FAIL-'+name.replace(/\W+/g,'-').slice(0,60))}};
try {
  const fixture=await navigationFixture(runtime.origin);
  const names=Object.fromEntries(fixture.projects.map(p=>[p.id,`Navigation ${p.name}`]));
  const bootstrapLogin=await fixture.call('/api/identity/login',{email:fixture.email,password:fixture.password});
  // The login session binds to the lowest project id; the other project is the deep-link target.
  const bound=fixture.projects.find(p=>p.id===bootstrapLogin.actor.projectId),other=fixture.projects.find(p=>p!==bound);
  const outsider=await runtime.seedTenant({name:'Outsider tenant',email:'outsider-shell@example.test',allowedOrigin:runtime.origin});
  const platformAdmin=await runtime.seedTenant({name:'Platform admin tenant',email:'platform-admin-shell@example.test',allowedOrigin:runtime.origin,platformAdmin:true});
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  page=await context.newPage();page.setDefaultTimeout(15000);
  const consoleLines=[];
  page.on('console',message=>consoleLines.push(`${message.type()}: ${message.text()}`));
  page.on('request',request=>requests.push({method:request.method(),url:request.url()}));
  await page.goto(runtime.origin+'/login?returnTo='+encodeURIComponent(`/projects/${bound.id}/conversations`));
  await page.getByLabel('Email',{exact:true}).fill(fixture.email);await page.getByLabel('Password',{exact:true}).fill(fixture.password);
  await page.getByRole('button',{name:'Login',exact:true}).click();await ready();

  await check('deep link to another member project activates it before data loads',async()=>{
    await bindSession(bound.id);
    await page.goto(`${runtime.origin}/projects/${other.id}/conversations/${other.conversationId}`);await ready();
    const transcriptMessage=page.locator('.transcript-message-content').getByText(other.message,{exact:true});
    await transcriptMessage.waitFor();
    assert.equal(await transcriptMessage.count(),1,'the opened transcript contains exactly one target message');
    assert.equal(await transcriptMessage.isVisible(),true,'the target conversation message is visible');
    await shot('deep-link-conversation');
    assert.equal(await api(`/api/conversations/${other.conversationId}/messages`),200,'conversation reads follow the URL project');
    assert.equal(await api(`/api/knowledge/${other.id}/articles`),200,'knowledge reads follow the URL project');
    assert.equal(await api(`/api/knowledge/${bound.id}/articles`),403,'the previously bound project is no longer the session project');
  });
  for(const section of ['articles','categories','datasets','training-runs','insights']) await check(`deep link to ${section} of another member project shows no access error`,async()=>{
    await bindSession(bound.id);
    await page.goto(`${runtime.origin}/projects/${other.id}/${section}`);await ready();
    await page.locator('#workspace-main .header-title').waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.getByText('Project access denied').count(),0,'no "Project access denied" banner');
    assert.equal(await page.locator('#workspace-main [role=alert]').count(),0,'no error alert on the page');
    if(section==='articles')await shot('deep-link-articles');
  });
  await check('opening a project from the Projects list activates it',async()=>{
    await bindSession(bound.id);
    await page.goto(runtime.origin+'/projects');await page.locator('.project-list-table').waitFor();
    await page.locator('.project-list-table').getByRole('link',{name:names[other.id],exact:true}).click();
    await page.waitForURL(`**/projects/${other.id}/conversations`);
    await nav().getByRole('button',{name:`Switch workspace: ${names[other.id]}`,exact:true}).waitFor();
    assert.equal(await api(`/api/knowledge/${other.id}/articles`),200);
  });
  for(const [label,projectId] of [['an unknown project',unknownId],['a project the account does not belong to',outsider.projectId],['a malformed project id','not-a-uuid']]) await check(`${label} shows an in-shell not-found state without a Sign in link`,async()=>{
    await page.goto(`${runtime.origin}/projects/${projectId}/conversations`);
    await page.getByRole('heading',{name:'Project not found',exact:true}).waitFor();
    assert.equal(await page.getByRole('link',{name:'Sign in'}).count(),0,'a signed-in user is never offered Sign in');
    assert.equal(await page.locator('#sidebar').count(),1,'the app shell is present');
    assert.equal(await page.getByText('Request failed').count(),0);
    assert.match(await page.locator('#workspace-main [role=alert]').innerText(),/not found, or your account does not have access/);
    assert.equal(await page.locator('.conversation-inbox').count(),0,'the inbox is not rendered under an unavailable project URL');
    if(projectId===unknownId)await shot('project-not-found');
    await page.getByRole('link',{name:'Go to Projects'}).click();
    await page.locator('.project-list-table').waitFor();
    assert.ok(new URL(page.url()).pathname==='/projects');
  });
  await check('/local-agent/authorize shows the project it acts on',async()=>{
    await bindSession(bound.id);
    await page.goto(`${runtime.origin}/local-agent/authorize?user_code=ABCD-EFGH`);await ready();
    await page.getByLabel('Authorization code',{exact:true}).waitFor();
    assert.equal(await nav().getByRole('button',{name:/Switch workspace:/}).getAttribute('aria-label'),`Switch workspace: ${names[bound.id]}`);
    assert.match(await page.locator('#workspace-main').innerText(),new RegExp(`applies to the project ${names[bound.id]}`));
    assert.equal(await nav().getByText('Global Inbox').count(),0);
    assert.match(await nav().locator('.nav-link.active').allInnerTexts().then(t=>t.join('|')),/Local computers/);
    await shot('local-agent-authorize');
  });
  await check('Global Inbox settings name the project each link acts on',async()=>{
    await page.goto(runtime.origin+'/conversations');await ready();
    await nav().getByRole('button',{name:/Switch workspace:/}).click();await nav().getByRole('button',{name:'Global Inbox',exact:true}).click();
    await nav().getByRole('button',{name:'Switch workspace: Global Inbox'}).waitFor();
    await settingsOpen();
    const links=await nav().locator('#sidebarSettings a').evaluateAll(anchors=>anchors.map(a=>[a.textContent,new URL(a.href).pathname]));
    assert.deepEqual(links.map(l=>l[0]).sort(),Object.values(names).map(n=>`Settings for ${n}`).sort());
    for(const p of fixture.projects)assert.ok(links.some(([text,path])=>text===`Settings for ${names[p.id]}`&&path===`/projects/${p.id}/edit`));
    await page.waitForTimeout(500);await shot('global-inbox-settings');
  });
  await check('/projects/<id>/settings highlights Project like /edit',async()=>{
    for(const path of ['edit','settings']){
      await page.goto(`${runtime.origin}/projects/${bound.id}/${path}`);await ready();await page.getByLabel('Website',{exact:true}).waitFor();
      assert.deepEqual(await page.getByTestId('settings-menu').locator('[aria-current="page"]').allInnerTexts(),['Project'],path);
      assert.equal(await nav().getByTestId('nav-settings').getAttribute('aria-current'),'page',path);
    }
  });
  await check('a project sidebar keeps six rows with the inbox views under Inbox; the Settings pages share one menu',async()=>{
    await page.setViewportSize({width:1440,height:900});
    await bindSession(bound.id);
    await page.goto(`${runtime.origin}/projects/${bound.id}/conversations`);await ready();
    // The five inbox views sit inside Inbox's item, so the primary list keeps its six rows.
    const inbox=nav().getByTestId('nav-primary').locator('> li').first();
    for(const view of ['mine','open','unassigned','ai','closed'])assert.equal(await inbox.locator(`nav[data-testid="inbox-views"] a[href*="view=${view}"]:visible`).count(),1,`the ${view} view sits under Inbox`);
    assert.equal(await nav().getByTestId('nav-primary').locator('> li').count(),6);
    const more=nav().getByTestId('nav-more');assert.equal(await more.getAttribute('open'),null,'More is closed on the inbox');
    await more.locator('summary').focus();await page.keyboard.press('Enter');
    assert.deepEqual(await more.locator('a').evaluateAll(links=>links.map(a=>new URL(a.href).pathname.split('/').pop())),['local-agent','reports','insights']);
    assert.equal(await page.getByTestId('settings-menu').count(),0,'the inbox has no Settings menu');
    await nav().getByTestId('nav-settings').click();
    const menu=page.getByTestId('settings-menu');await menu.waitFor();
    const paths=new Set();
    for(const name of ['Project','Agents','Email','Widget','Saved Replies','API tokens','Webhooks','Slack','Delivery log','Plugins','GitHub','Roles','Security','Security log','Connected applications']){
      const entry=menu.getByRole('link',{name,exact:true});
      if(!await entry.isVisible())await menu.getByTestId('settings-menu-more').locator('summary').click();
      await entry.click();await entry.and(menu.locator('[aria-current="page"]')).waitFor();
      // The link is current while the destination still loads; continue once its page is shown.
      await page.getByRole('heading',{level:1,name:{GitHub:'Project'}[name]||name,exact:true}).waitFor();
      assert.equal(await menu.locator('[aria-current="page"]').count(),1,name);
      assert.equal(await nav().getByTestId('nav-settings').getAttribute('aria-current'),'page',name);
      assert.equal(await page.locator('h1').count(),1,name);paths.add(new URL(page.url()).pathname);
    }
    assert.equal(paths.size,15,'each destination is its own page');
    await nav().getByRole('link',{name:'Contacts',exact:true}).click();await page.getByRole('heading',{name:'Contacts',level:1}).waitFor();
    assert.equal(await page.getByTestId('settings-menu').count(),0,'Contacts has no Settings menu');
  });
  for(const [width,height] of [[1440,700],[1440,900],[1280,800]]) await check(`the active sidebar item and Settings are fully visible at ${width}x${height}`,async()=>{
    await page.setViewportSize({width,height});
    await page.goto(`${runtime.origin}/projects/${bound.id}/local-agent`);await ready();
    await page.getByRole('heading',{name:'Local computers',level:1}).waitFor();
    await page.waitForFunction(()=>document.querySelector('.navbar-scroll .nav-link.active'));
    const rects=await page.evaluate(()=>{const box=document.querySelector('.navbar-scroll').getBoundingClientRect(),link=document.querySelector('.navbar-scroll .nav-link.active').getBoundingClientRect();return {boxTop:box.top,boxBottom:box.bottom,top:link.top,bottom:link.bottom}});
    assert.ok(rects.top>=rects.boxTop-1&&rects.bottom<=rects.boxBottom+1,`active link ${rects.top}-${rects.bottom} must sit inside the sidebar ${rects.boxTop}-${rects.boxBottom}`);
    const settings=await nav().getByTestId('nav-settings').evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {top:r.top,bottom:r.bottom,reachable:el.contains(hit),height:innerHeight}});
    assert.ok(settings.top>=0&&settings.bottom<=settings.height&&settings.reachable,`Settings ${settings.top}-${settings.bottom} must be visible in a ${settings.height}px viewport`);
    if(height===700)await shot('sidebar-active-visible-700');
    await page.setViewportSize({width:1440,height:900});
  });
  for(const project of [bound,other]) await check(`account menu text meets AA contrast (${project.mode} workspace)`,async()=>{
    await bindSession(project.id);
    await page.goto(`${runtime.origin}/projects/${project.id}/conversations`);await ready();
    await page.locator('#sidebarUser').getByRole('button',{name:'Account menu'}).click();
    const rows=await page.locator('.native-account-dropdown .dropdown-item').evaluateAll(items=>items.map(item=>{
      const rgb=value=>value.match(/[\d.]+/g).slice(0,4).map(Number);let node=item,background=[255,255,255];
      while(node){const value=rgb(getComputedStyle(node).backgroundColor);if(value.length<4||value[3]>0){background=value.slice(0,3);break}node=node.parentElement}
      return {text:item.textContent,color:rgb(getComputedStyle(item).color).slice(0,3),background};
    }));
    assert.deepEqual(rows.map(r=>r.text),['Profile','Sign out'],'a project owner who is not a platform administrator is not offered Admin');
    for(const row of rows)assert.ok(contrast(row.color,row.background)>=4.5,`${row.text} contrast ${contrast(row.color,row.background).toFixed(2)}`);
    if(project===bound){await page.waitForTimeout(500);await shot('account-menu')}
    await page.keyboard.press('Escape');
  });
  await check('non-platform-admin /admin pages deny cleanly without forms or admin requests',async()=>{
    const before=requests.length;
    for(const path of ['/admin','/admin/users','/admin/ai_defaults/create','/admin/leads/create']){
      await page.goto(runtime.origin+path);await ready();
      await page.getByRole('heading',{name:'Administration',exact:true,level:1}).waitFor();
      assert.match(await page.locator('#workspace-main [role=alert]').innerText(),/limited to platform administrators/,path);
      assert.equal(await page.getByRole('button',{name:'Save',exact:true}).count(),0,path);
      assert.equal(await page.locator('#workspace-main form').count(),0,path);
    }
    assert.equal(requests.slice(before).filter(r=>r.url.includes('/api/management/admin/')).length,0,'no admin API calls are made for a non-admin');
    await shot('admin-denied');
  });
  await check('a platform administrator still gets the Admin menu entry and working admin pages',async()=>{
    const adminContext=await browser.newContext({viewport:{width:1440,height:900}});
    await adminContext.addCookies([{name:'h2h_session',value:platformAdmin.token,url:runtime.origin}]);
    const adminPage=await adminContext.newPage();adminPage.setDefaultTimeout(15000);
    const adminRequests=[];adminPage.on('request',request=>adminRequests.push(new URL(request.url()).pathname));
    try{
      await adminPage.goto(runtime.origin+'/conversations');
      await adminPage.locator('#sidebarUser').getByRole('button',{name:'Account menu'}).click();
      await adminPage.getByRole('link',{name:'Admin',exact:true}).click();
      await adminPage.getByRole('navigation',{name:'Administration navigation'}).waitFor();
      await adminPage.getByRole('heading',{name:'Projects',level:1}).waitFor();
      await adminPage.waitForLoadState('networkidle');
      assert.equal(await adminPage.locator('#workspace-main [role=alert]').count(),0);
      await adminPage.getByText('Platform admin tenant').first().waitFor();
      // The administration rail is HappyToHelp's own: it draws the mark inline in the nav's ink, aqua sparks kept, no filter.
      const toggle=adminPage.getByRole('navigation',{name:'Administration navigation'}).locator('.navbar-workspace-toggle');
      assert.equal(await toggle.locator('svg.brand-mark[aria-hidden="true"]').count(),1,'one decorative mark');
      assert.equal(await toggle.locator('img').count(),0,'no image mark');
      assert.equal(await adminPage.getByRole('link',{name:'HappyToHelp Administration',exact:true}).count(),1,'the toggle is named HappyToHelp Administration');
      const mark=await toggle.evaluate(link=>{const svg=link.querySelector('svg.brand-mark'),box=svg.getBoundingClientRect(),outer=link.getBoundingClientRect(),paths=[...svg.querySelectorAll('path')];return {ink:getComputedStyle(link).color,bubble:getComputedStyle(paths[0]).stroke,sparks:[...new Set(paths.slice(4).map(path=>getComputedStyle(path).stroke))],filter:getComputedStyle(svg).filter,height:box.height,inside:box.left>=outer.left&&box.right<=outer.right&&box.top>=outer.top&&box.bottom<=outer.bottom}});
      // The rail wears the dark palette (Ink rail), so the nav's ink is the rail's own --ink, not the page's.
      const ink=await adminPage.evaluate(()=>{const hex=getComputedStyle(document.querySelector('#sidebar')).getPropertyValue('--ink').trim();return 'rgb('+hex.slice(1).match(/../g).map(v=>parseInt(v,16)).join(', ')+')'});
      assert.equal(mark.ink,ink,'the nav\'s ink is the rail\'s ink');
      assert.equal(mark.bubble,mark.ink,'the bubble is drawn in the nav\'s ink');
      assert.deepEqual(mark.sparks,['rgb(143, 227, 238)'],'aqua sparks');
      assert.equal(mark.filter,'none','no filter recolours the mark');
      assert.ok(Math.abs(mark.height-28)<=1,`the mark is 28px tall (${mark.height})`);
      assert.ok(mark.inside,'the mark sits inside the toggle');
      assert.equal(adminRequests.filter(path=>path==='/img/icon.svg').length,0,'the old icon is never requested');
      await adminPage.screenshot({path:join(evidence,'admin-nav.png')});
    }finally{await adminContext.close()}
  });
  await check('the dashboard load-error screen is headed by the HappyToHelp lockup',async()=>{
    const failing=await context.newPage();
    try{
      // A document load reads the workspace on the server; a client navigation
      // reads it through Start's server function. Fail that load and its API calls.
      await failing.goto(runtime.origin+'/projects');await failing.locator('.project-list-table').waitFor();
      await failing.route('**/api/**',route=>route.abort());
      await failing.route('**/_serverFn/**',route=>route.abort());
      await failing.locator('.project-list-table').getByRole('link',{name:names[other.id],exact:true}).click();
      const heading=failing.getByRole('heading',{level:1,name:'HappyToHelp'});
      await heading.waitFor();
      assert.equal(await heading.count(),1,'one heading named HappyToHelp');
      assert.deepEqual(await heading.locator('a.brand').evaluateAll(links=>links.map(link=>[link.getAttribute('href'),[...link.children].map(child=>`${child.localName}.${child.getAttribute('class')}`)])),[['/',['svg.brand-mark','svg.brand-word','span.brand-name']]],'the lockup links home');
      assert.ok(await heading.locator('.brand-name').evaluate(name=>{const box=name.getBoundingClientRect();return box.width<=1&&box.height<=1}),'the lockup\'s name is visually hidden');
      assert.equal(await failing.getByRole('button',{name:'Try again'}).count(),1,'a way to retry');
      await failing.screenshot({path:join(evidence,'dashboard-load-error.png')});
      await failing.unroute('**/api/**');await failing.unroute('**/_serverFn/**');
    }finally{await failing.close()}
  });
  await check('Projects list: owner reads Owner, Name is not a fake sort control, row actions are tappable',async()=>{
    await bindSession(bound.id);
    await page.goto(runtime.origin+'/projects');await page.locator('.project-list-table tbody tr').nth(fixture.projects.length-1).waitFor();
    const roles=await page.locator('.project-list-table tbody tr td:nth-child(2)').allInnerTexts();
    assert.deepEqual(roles,fixture.projects.map(()=>'Owner'));
    assert.equal((await page.locator('.project-list-table thead th').first().textContent()).trim(),'Name');
    for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
      await page.setViewportSize(viewport);await page.reload();await page.locator('.project-list-table tbody tr').nth(fixture.projects.length-1).waitFor();
      for(const box of await page.locator('.project-list-menu summary').evaluateAll(items=>items.map(i=>{const r=i.getBoundingClientRect();return [r.width,r.height]})))
        assert.ok(box[0]>=24&&box[1]>=24,`${viewport.width}px: row action ${box[0]}x${box[1]} is at least 24x24`);
    }
    await shot('projects-mobile');
    await page.setViewportSize({width:1440,height:900});
  });
  await check('/users/<other-id> is not a page; own profile routes still work',async()=>{
    const ownId=await page.evaluate(async()=>(await (await fetch('/api/management/bootstrap')).json()).currentAgent.id);
    await page.goto(`${runtime.origin}/users/${unknownId}`);await ready();
    await page.getByText('This page was not found.').waitFor();
    assert.equal(await page.getByLabel('Timezone').count(),0,'no profile form for another id');
    await shot('users-other-id');
    for(const segment of ['profile',ownId]){
      await page.goto(`${runtime.origin}/users/${segment}`);await ready();
      await page.getByRole('button',{name:'Update',exact:true}).waitFor();
      assert.equal(await page.getByText('This page was not found.').count(),0,segment);
    }
  });
  await check('a tab whose project another tab displaced re-activates it when focused',async()=>{
    await page.goto(`${runtime.origin}/projects/${other.id}/articles`);await ready();
    await page.locator('#workspace-main .header-title').waitFor();
    const second=await context.newPage();second.setDefaultTimeout(15000);
    try{
      await second.goto(`${runtime.origin}/projects/${bound.id}/articles`);
      await second.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:`Switch workspace: ${names[bound.id]}`,exact:true}).waitFor();
      assert.equal(await api(`/api/knowledge/${other.id}/articles`),403,'the second tab moved the shared session to its project');
      await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await page.waitForFunction(async id=>(await fetch(`/api/knowledge/${id}/articles`)).status===200,other.id,{polling:200});
      await page.waitForLoadState('networkidle');
      assert.equal(await page.getByText('Project access denied').count(),0,'no "Project access denied" after returning to the tab');
      assert.equal(await page.locator('#workspace-main [role=alert]').count(),0);
      await second.bringToFront();await second.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await second.waitForFunction(async id=>(await fetch(`/api/knowledge/${id}/articles`)).status===200,bound.id,{polling:200});
    }finally{await second.close()}
  });
  await check('dashboard loads open project sockets without teardown warnings',async()=>{
    const fresh=await context.newPage();const lines=[];let sockets=[];
    fresh.on('console',message=>lines.push(`${message.type()}: ${message.text()}`));
    fresh.on('websocket',socket=>sockets.push(socket));
    // A socket closed while still connecting is the browser warning this check guards against.
    await fresh.addInitScript(()=>{const close=WebSocket.prototype.close;window.__closedWhileConnecting=0;WebSocket.prototype.close=function(...args){if(this.readyState===0)window.__closedWhileConnecting++;return close.apply(this,args)}});
    try{
      for(const path of ['/projects','/users/profile',`/projects/${bound.id}/conversations`]){
        sockets=[];
        await fresh.goto(runtime.origin+path);await fresh.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/Switch workspace:/}).waitFor();
        await fresh.waitForTimeout(1500);
        const open=sockets.filter(socket=>!socket.isClosed()&&/\/api\/projects\/[^/]+\/socket/.test(socket.url()));
        assert.equal(await fresh.evaluate(()=>window.__closedWhileConnecting),0,`${path}: no socket is closed before its handshake completes`);
        assert.equal(open.length,path==='/projects'||path==='/users/profile'?fixture.projects.length:1,`${path}: one live project socket per connected project`);
      }
      const noisy=lines.filter(line=>/closed before the connection is established|Live connection unavailable/.test(line));
      assert.deepEqual(noisy,[],'no WebSocket teardown or false reconnect warnings');
    }finally{await fresh.close()}
  });
  await context.close();
} finally {
  await browser.close();
  const failed=results.filter(r=>!r.ok);
  await runtime.close(failed.length===0);
  console.log(`workspace shell browser checks: ${results.length-failed.length}/${results.length} passed; evidence ${evidence}`);
  if(failed.length)throw new Error(`workspace shell checks failed: ${failed.map(r=>r.name+': '+r.error).join('; ')}`);
}

}
