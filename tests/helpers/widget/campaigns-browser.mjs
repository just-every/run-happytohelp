import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {join} from 'node:path';

// The campaign editor, the installed offer, and Reports on the real emitted application at both widths.
export async function campaignsBrowser({browser,page,origin,projectId,owner,evidenceDir}){
 const headers={Authorization:`Bearer ${owner.token}`,'Content-Type':'application/json'};
 const call=async(path,body,method=body===undefined?'GET':'POST')=>{const response=await fetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});assert.ok(response.ok,`${path}: ${response.status} ${await response.clone().text()}`);return response.json();};
 const settings=await call(`/api/management/projects/${projectId}/widget-settings`),widgetKey=settings.widgetKey;
 const host=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Synthetic checkout</h1><p>Your checkout stays here while support offers help.</p><script src="${origin}/widget.js" data-api-origin="${origin}" data-widget-key="${widgetKey}"></script></body></html>`);});
 await new Promise(done=>host.listen(0,'127.0.0.1',done));const site=`http://127.0.0.1:${host.address().port}`;
 await call(`/api/management/projects/${projectId}/widget-settings`,{...settings.settings,allowed_origin:site},'PUT');
 await call(`/api/management/projects/${projectId}/settings`,{is_contact_tracking_enabled:true,proactive_help_enabled:true},'PUT');
 const endpoint=`/api/management/projects/${projectId}/widget-campaigns`;
 try{
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:width===1440?900:844});
   await page.goto(`${origin}/projects/${projectId}/widget-settings#campaigns`);
   const editor=page.getByRole('region',{name:'Proactive campaigns'});
   await editor.getByRole('button',{name:'New campaign',exact:true}).click();
   await editor.getByLabel('Campaign name',{exact:true}).fill(`Checkout ${width}`);
   await editor.getByLabel('Sender name',{exact:true}).fill('Alex from Support');
   await editor.getByLabel('Brand name',{exact:true}).fill('Synthetic shop');
   await editor.getByLabel('Message',{exact:true}).fill(`Need a hand at checkout ${width}?`);
   await editor.getByLabel('Campaign enabled',{exact:true}).check();
   await editor.getByLabel('Quiet hours enabled',{exact:true}).uncheck();
   await editor.getByRole('button',{name:'Save campaign',exact:true}).click();
   await editor.getByRole('status').filter({hasText:'Campaign saved.'}).waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`settings fit at ${width}`);
   await page.screenshot({path:join(evidenceDir,`campaign-settings-${width}.png`),fullPage:true});
   const {campaigns}=await call(endpoint),campaign=campaigns.find(c=>c.name===`Checkout ${width}`);assert.ok(campaign);
   assert.equal(campaign.trigger.type,'time');assert.equal(campaign.trigger.seconds,20);assert.equal(campaign.dailyCap,1);
   const context=await browser.newContext({viewport:{width,height:width===1440?900:844}}),visitor=await context.newPage(),errors=[],writes=[];
   visitor.on('pageerror',e=>errors.push(e.message));
   visitor.on('request',request=>{if(request.method()==='POST')writes.push({url:request.url(),body:request.postData()});});
   const card=visitor.getByRole('region',{name:'Help before you ask'});
   try{
    await visitor.goto(site+'/checkout');
    await visitor.getByRole('button',{name:'Open chat',exact:true}).first().click();
    await visitor.getByRole('button',{name:'No thanks',exact:true}).click();
    await visitor.getByRole('button',{name:'Close chat',exact:true}).first().click();
    await visitor.waitForTimeout(21000);
    assert.equal(await card.count(),0,'declined visitor gets no campaign');
    assert.equal(writes.filter(w=>w.body?.includes('campaignEvaluate')).length,0,'decline sends no campaign context');
    await visitor.getByRole('button',{name:'Open chat',exact:true}).first().click();
    await visitor.getByRole('button',{name:'Allow proactive help',exact:true}).click();
    await visitor.getByRole('button',{name:'Close chat',exact:true}).first().click();
    await card.waitFor({timeout:20000});
    assert.match(await card.innerText(),/Alex from Support/);assert.match(await card.innerText(),/Synthetic shop/);
    const session=await visitor.evaluate(key=>JSON.parse(localStorage.getItem(key)),`rer-widget:${origin}:${widgetKey}`);
    assert.ok(session?.conversationId);
    const transcript=()=>call(`/api/conversations/${session.conversationId}/messages`);
    assert.equal((await transcript()).messages.length,0,'display sends no visitor message');
    assert.ok(await visitor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`offer fits at ${width}`);
    await visitor.screenshot({path:join(evidenceDir,`campaign-offer-${width}.png`),fullPage:true});
    if(width===1440){
     await card.getByRole('button',{name:'Dismiss',exact:true}).click();await card.waitFor({state:'hidden'});
     await visitor.reload();await visitor.waitForTimeout(21000);assert.equal(await card.count(),0,'daily cap survives dismissal and reload');
    }else{
     await card.getByRole('button',{name:'Open chat',exact:true}).click();
     await visitor.locator('textarea[name=content]').waitFor({state:'visible'});
     assert.equal((await transcript()).messages.length,0,'opening leaves an empty composer');
     // The visitor explicitly supplies the email and message demanded by the current away policy.
     const email=visitor.locator('input[name=email]');
     if(await email.isVisible()){await email.fill('synthetic-happytohelp-2@example.test');await email.press('Enter');}
     await visitor.locator('textarea[name=content]').fill('I chose to ask about my checkout');await visitor.locator('button[name=submit]').click();
     await visitor.getByText('I chose to ask about my checkout',{exact:true}).waitFor();
    }
    await page.goto(`${origin}/projects/${projectId}/reports`);
    const report=page.getByRole('region',{name:'Proactive campaign reporting'});await report.waitFor();
    const row=report.getByRole('row').filter({hasText:`Checkout ${width}`});
    const counts=await row.locator('td').allTextContents();
    assert.deepEqual(counts,width===1440?['1','0','1','0','0']:['1','1','0','1','0']);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`reports fit at ${width}`);
    await report.scrollIntoViewIfNeeded();await page.screenshot({path:join(evidenceDir,`campaign-reports-${width}.png`),fullPage:true});
    assert.deepEqual(errors,[]);
   }finally{await context.close();}
   const {id,revision,...config}=campaign;
   await call(endpoint+'/'+id,{...config,revision,enabled:false},'PUT');
  }
 }finally{await new Promise(done=>host.close(done));}
}
