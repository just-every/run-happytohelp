import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {createRuntime} from '../emitted-runtime.mjs';

export async function assistantBrowser({browser,evidenceDir}){
 const runtime=await createRuntime({vars:{OPENAI_API_KEY:'synthetic-happytohelp-3'},queueConsumers:true,outboundFixture:new URL('./assistant-network.mjs',import.meta.url).href});
 let success=false,host;
 try{
  const owner=await runtime.seedTenant({name:'Assistant disclosure',email:'synthetic-happytohelp-3@example.test',allowedOrigin:runtime.origin});
  const call=async(path,body,method=body===undefined?'GET':'POST')=>{const response=await fetch(runtime.origin+path,{method,headers:{Authorization:`Bearer ${owner.token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(response.ok,`${path}: ${response.status}`);return response.json();};
  const settings=await call(`/api/management/projects/${owner.projectId}/widget-settings`);
  const ai=await call(`/api/management/projects/${owner.projectId}/ais`,{name:'Checkout helper',role:'Support',prompt:'Help with checkout.',model:'gpt-5.6-luna',is_enabled:true});
  const aiId=ai.id||ai.data?.id;assert.ok(aiId);
  await call(`/api/management/projects/${owner.projectId}/settings`,{default_responder:aiId},'PUT');
  host=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Synthetic support page</h1><script src="${runtime.origin}/widget.js" data-api-origin="${runtime.origin}" data-widget-key="${settings.widgetKey}"></script></body></html>`);});
  await new Promise(done=>host.listen(0,'127.0.0.1',done));const site=`http://127.0.0.1:${host.address().port}`;
  await call(`/api/management/projects/${owner.projectId}/widget-settings`,{allowed_origin:site,text:{ai:{chat:'Welcome'}}},'PUT');
  const state=await fetch(`${runtime.origin}/api/widget/settings?widgetKey=${settings.widgetKey}`,{headers:{Origin:site}}).then(r=>r.json());assert.equal(state.availability.available,true,'a provider-ready assistant is available with no teammate online');
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:width===1440?900:844}}),page=await context.newPage();
   try{
    await page.goto(site);await page.getByRole('button',{name:'Open chat',exact:true}).first().click();
    await page.getByText('AI assistant',{exact:true}).first().waitFor();
    await page.locator('textarea[name=content]').fill('Can you help me with checkout?');await page.locator('button[name=submit]').click();
    await page.getByText('I am the AI assistant. I can help with your checkout question.',{exact:true}).waitFor({timeout:45000});
    const session=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('rer-widget:')).map(([,value])=>JSON.parse(value))[0]);
    const transcript=await fetch(`${runtime.origin}/api/conversations/${session.conversationId}/messages`,{headers:{Authorization:`Bearer ${session.token}`}}).then(response=>{assert.ok(response.ok);return response.json();});
    assert.equal(transcript.widget.ai_id,aiId,'the public transcript identifies its assigned AI without operator-only state');
    assert.ok(transcript.messages.some(message=>message.actor_role==='ai'&&message.content.includes('I am the AI assistant.')),'the visible answer is an admitted AI message');
    await page.reload();await page.getByRole('button',{name:'Open chat',exact:true}).first().click();
    await page.getByText('AI assistant',{exact:true}).first().waitFor();
    await page.getByText('I am the AI assistant. I can help with your checkout question.',{exact:true}).waitFor();
    await page.screenshot({path:join(evidenceDir,`assistant-disclosure-${width}.png`),fullPage:true});
   }catch(error){await page.screenshot({path:join(evidenceDir,`assistant-failure-${width}.png`),fullPage:true});throw error;}finally{await context.close();}
  }
  success=true;
 }finally{if(host)await new Promise(done=>host.close(done));await runtime.close(success);}
}
