import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {build} from 'esbuild'
import {createRuntime} from '../emitted-runtime.mjs'
import {launchBrowser} from '../../journeys/kit/browser.mjs'

// A plugin the owner configured, framed beside a conversation and built on the published plugin SDK from its own
// origin: it fills the operator's draft, reads only the active conversation, sizes its frame and resolves only that
// conversation. A frame that wandered to another origin, and the operator page itself, cannot command the inbox.
export async function pluginFrame(){
 const sdk=(await build({entryPoints:['src/modules/plugin-sdk/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent'})).outputFiles[0].text
 const servers=[]
 const serve=handler=>new Promise(resolve=>{const server=createServer(handler);server.listen(0,'127.0.0.1',()=>{servers.push(server);resolve(`http://127.0.0.1:${server.address().port}`)})})
 const html=(response,body)=>{response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(`<!doctype html><meta charset="utf-8"><title>Fixture plugin</title><body>${body}</body>`)}
 // A third origin that sends a well-formed command to whatever frames it.
 const rogue=await serve((request,response)=>html(response,`<script>parent.postMessage({happytohelp:true,type:'setMessageContent',payload:'Rogue draft'},'*');parent.postMessage({happytohelp:true,type:'setHeight',payload:'999px'},'*')</script>`))
 const plugin=await serve((request,response)=>{
  const url=new URL(request.url,'http://plugin')
  if(url.pathname==='/sdk.mjs'){response.writeHead(200,{'Content-Type':'text/javascript'});response.end(sdk);return}
  // The wandering plugin leaves its configured origin before it speaks.
  if(url.pathname==='/wander'){response.writeHead(302,{Location:rogue+'/'});response.end();return}
  html(response,`<p id="state">[]</p><script type="module">
import {createPluginClient} from './sdk.mjs';
const client=createPluginClient({hostOrigin:new URLSearchParams(location.search).get('host')}),log=[];
const show=()=>{document.getElementById('state').textContent=JSON.stringify(log)};
client.on('setConversation',conversation=>{log.push({conversation:conversation?.id??null});show()});
client.on('error',error=>{log.push({error:error.command});show()});
window.plugin=client;window.ready=true;
</script>`)
 })
 const runtime=await createRuntime()
 let browser,success=false
 try{
  const origin=runtime.origin
  const request=async(path,{token,body,method=body===undefined?'GET':'POST',headers={}}={})=>{const response=await fetch(origin+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.ok(response.ok,`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);return data}
  const owner={email:'plugin-owner@example.test',password:'synthetic-plugin-frame-owner-password'}
  const setup=await request('/api/identity/bootstrap',{body:{...owner,name:'Plugin workspace',allowedOrigin:origin}}),projectId=setup.projectId,token=setup.token
  const api=`/api/management/projects/${projectId}`
  await request(`${api}/plugins`,{token,body:{name:'Order lookup',url:`${plugin}/frame?host=${encodeURIComponent(origin)}`}})
  await request(`${api}/plugins`,{token,body:{name:'Wandering plugin',url:`${plugin}/wander?host=${encodeURIComponent(origin)}`}})
  // Two visitor conversations: the plugin may act on the one the operator has open, never the other.
  const project=await request(`/api/identity/projects/${projectId}`,{token})
  const conversation=async text=>{const visitor=await request('/api/identity/widget/session',{headers:{Origin:origin},body:{widgetKey:project.widget_key,name:text}});const created=await request('/api/conversations',{token:visitor.token,body:{projectId}});await request(`/api/conversations/${created.id}/messages`,{token:visitor.token,body:{localId:text,content:text,expectedRevision:0}});return created.id}
  const active=await conversation('Where is my order?'),other=await conversation('A different question')
  browser=await launchBrowser()
  for(const [width,height] of [[1440,900],[390,844]]){
   const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.setDefaultTimeout(15000)
   const problems=[];page.on('pageerror',error=>problems.push(error.message))
   try{
    await context.addCookies([{name:'h2h_session',value:token,url:origin}])
    await page.goto(`${origin}/projects/${projectId}/conversations/${active}`)
    const composer=page.getByRole('textbox',{name:'Reply to conversation'});await composer.waitFor()
    // Each plugin is its own section of the conversation panel's Ticket tab; at phone width the panel opens on request.
    const frameElement=page.locator('iframe[title="Order lookup"]'),toggle=page.getByRole('button',{name:'Show conversation panel'})
    if(await toggle.isVisible())await toggle.click()
    await page.getByRole('tab',{name:'Ticket',exact:true}).click();await page.locator('#conversation-details-panel .ticket-section__toggle').filter({hasText:'Order lookup'}).click()
    await frameElement.waitFor({state:'attached'})
    // The plugin's section can sit below the fold of the panel, and Chromium runs no animation frames in a cross-origin
    // frame out of view: Playwright's default requestAnimationFrame polling would check the plugin's state once and never
    // again, so waits inside the frame poll on a timer.
    const frame=await (await frameElement.elementHandle()).contentFrame(),waitInFrame=predicate=>frame.waitForFunction(predicate,undefined,{polling:100})
    await waitInFrame(()=>window.ready===true)
    const log=async()=>JSON.parse(await frame.locator('#state').textContent())
    // The wandering frame and the operator page itself are ignored.
    await page.locator('iframe[title="Wandering plugin"]').waitFor({state:'attached'})
    await page.waitForTimeout(500);await page.evaluate(()=>window.postMessage({happytohelp:true,type:'setMessageContent',payload:'Forged draft'},'*'))
    await page.waitForTimeout(300);assert.equal(await composer.inputValue(),'','no frame but the configured plugin origin can set the draft')
    assert.notEqual(await page.locator('iframe[title="Wandering plugin"]').getAttribute('height'),'999px','a frame off its configured origin cannot resize itself')
    // The configured plugin reads the active conversation, fills the draft and sizes its frame.
    await frame.evaluate(()=>window.plugin.getConversation())
    await waitInFrame(()=>document.getElementById('state').textContent.includes('conversation'))
    const told=await log();assert.ok(told.length&&told.every(entry=>entry.conversation===active),'the plugin is told only the open conversation: '+JSON.stringify(told))
    await frame.evaluate(width=>window.plugin.setMessageContent(`Your order ships today (${width})`),width)
    await page.waitForFunction(width=>document.querySelector('textarea[aria-label="Reply to conversation"], [aria-label="Reply to conversation"]')?.value===`Your order ships today (${width})`,width)
    await frame.evaluate(()=>window.plugin.setHeight('321px'))
    await page.waitForFunction(()=>document.querySelector('iframe[title="Order lookup"]').getAttribute('height')==='321px')
    // Commands outside the protocol never leave the plugin; resolving another conversation is refused to the plugin.
    assert.match(await frame.evaluate(()=>{try{window.plugin.setHeight('100%');return 'sent'}catch(error){return error.message}}),/Invalid/)
    if(width===1440){
     await frame.evaluate(other=>window.plugin.resolveConversation(other),other)
     await waitInFrame(()=>document.getElementById('state').textContent.includes('error'))
     assert.deepEqual((await log()).at(-1),{error:'resolveConversation'})
     assert.equal((await request(`/api/dashboard/projects/${projectId}/conversations/${other}`,{token})).data.resolved_at??null,null,'the other conversation stays open')
    }else{
     await frame.evaluate(active=>window.plugin.resolveConversation(active),active)
     const closed=async()=>Boolean((await request(`/api/dashboard/projects/${projectId}/conversations/${active}`,{token})).data.resolved_at)
     for(let attempt=0;attempt<60&&!await closed();attempt++)await new Promise(done=>setTimeout(done,250))
     assert.ok(await closed(),'the plugin resolved the conversation the operator has open')
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal page scroll')
    assert.deepEqual(problems,[])
   }finally{await context.close()}
  }
  success=true
 }finally{await browser?.close();await runtime.close(success);for(const server of servers)server.close()}
}
