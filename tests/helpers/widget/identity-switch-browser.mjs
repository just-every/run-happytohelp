import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {createHmac,randomBytes,randomUUID} from 'node:crypto'
import {createRuntime} from '../emitted-runtime.mjs'
import {evidence,viewports} from '../../journeys/kit/browser.mjs'

// One shared browser, many visitors: the built /widget.js on a real loopback host page against the emitted Worker.
// ChargeDesk's legacy form (projectId alias, unverified name/email/identifier, an old hash) and the native signed form.
export async function widgetIdentitySwitchBrowser(browser){
 const shot=await evidence('widget-identity-switch')
 const site=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Account</title><body><h1>Your account</h1></body></html>')})
 await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve))
 const website=`http://127.0.0.1:${site.address().port}`
 const runtime=await createRuntime()
 const context=await browser.newContext({viewport:viewports.desktop}),page=await context.newPage(),errors=[]
 page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
 let passed=false
 try{
  const owner=await runtime.seedTenant({name:'Morgan',email:'synthetic-identity-switch@example.test',allowedOrigin:website})
  const alias=randomUUID(),secret=randomBytes(32).toString('hex')
  await runtime.execute(`INSERT INTO public_project_aliases(slug,project_id) VALUES('${alias}','${owner.projectId}'); UPDATE projects SET verification_secret='${secret}' WHERE id='${owner.projectId}'`)
  const call=async(path,{token=owner.token,body,status=body===undefined?200:201,headers={}}={})=>{
   const response=await fetch(runtime.origin+path,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})})
   assert.equal(response.status,status,`${body===undefined?'GET':'POST'} ${path}`);return response.json()
  }
  const widgetKey=(await call('/api/identity/projects/'+owner.projectId)).widget_key
  const until=async(check,label)=>{for(const end=Date.now()+20000;Date.now()<end;await new Promise(r=>setTimeout(r,100))){const value=await check();if(value)return value}throw new Error('Timed out waiting for '+label)}

  // Every API request and socket of the current page load, with the bearer it carried.
  let requests=[],sockets=[],server=null,load=0
  page.on('request',request=>{if(request.url().startsWith(runtime.origin+'/api/'))requests.push(request.allHeaders().then(headers=>({method:request.method(),path:new URL(request.url()).pathname,auth:headers.authorization||''})))})
  await page.routeWebSocket(/\/api\/conversations\/[^/]+\/socket/,ws=>{const url=new URL(ws.url());sockets.push({token:url.searchParams.get('token'),conversationId:url.pathname.split('/')[3]});server=ws.connectToServer()})
  const legacy=contact=>({projectId:alias,apiOrigin:runtime.origin,open:true,settings:{collector:{enabled:false}},...(contact?{contact}:{})})
  const native=contact=>({widgetKey,apiOrigin:runtime.origin,open:true,settings:{collector:{enabled:false}},...(contact?{contact}:{})})
  const visit=async(options,{queue,global='h2h'}={})=>{
   await page.goto(`${website}/account/${++load}`);requests=[];sockets=[]
   if(queue||global!=='h2h')await page.evaluate(({queue,global})=>{window[global+'Queue']=queue||[]},{queue,global})
   await page.addScriptTag({url:runtime.origin+'/widget.js'})
   if(options)await page.evaluate(({options,global})=>window[global]('init',options),{options,global})
  }
  const shown=text=>page.getByText(text,{exact:true})
  // The visitor this page acts as: its socket's session, its contact (the profile route) and its conversation.
  const visitor=async({ui=true}={})=>{
   await until(()=>sockets.length,'the conversation socket');if(ui)await page.locator('textarea[name=content]').waitFor()
   // Settled once the session's presence ping and consent check have gone out.
   await until(async()=>(await Promise.all(requests)).filter(request=>request.path.endsWith('/widget-events')).length>=2,'the visitor\'s presence and consent')
   const {token,conversationId}=sockets.at(-1)
   return {token,conversationId,contact:(await call('/api/identity/widget/profile',{token})).contact}
  }
  const created=async()=>(await Promise.all(requests)).filter(request=>request.method==='POST'&&request.path==='/api/identity/widget/session').length
  // No request of this page load carries another visitor's bearer token (HTTP or socket) or touches its conversation.
  const isolated=async(...others)=>{
   const seen=await Promise.all(requests)
   for(const other of others){
    assert.ok(!seen.some(request=>request.auth==='Bearer '+other.token)&&!sockets.some(socket=>socket.token===other.token),'no request carries another visitor\'s token')
    assert.ok(!seen.some(request=>request.path.includes(other.conversationId))&&!sockets.some(socket=>socket.conversationId===other.conversationId),'no request touches another visitor\'s conversation')
   }
  }
  const absent=async(...texts)=>{for(const text of texts)assert.equal(await shown(text).count(),0,`"${text}" is not shown to this visitor`)}
  const landed=async(v,text)=>{
   await until(async()=>(await call(`/api/conversations/${v.conversationId}/messages`)).messages.some(message=>message.content===text),`${text} in the operator's conversation`)
   assert.equal((await call(`/api/conversations/${v.conversationId}`)).contact_id,v.contact.id,'the message lands in this visitor\'s own conversation')
  }
  const say=async(v,text)=>{await page.locator('textarea[name=content]').fill(text);await page.locator('button[name=submit]').click();await shown(text).waitFor();await landed(v,text)}
  const unproven=async contactId=>/"unproven":\s*1/.test(await runtime.execute(`SELECT json_extract(metadata_json,'$.email_unproven') AS unproven FROM contacts WHERE id='${contactId}'`))

  // ChargeDesk's signed-in page: name, email, identifier=email and an old signature the legacy form strips.
  const person=(name,email)=>({name,email,identifier:email,hash:'0'.repeat(64)})
  const avery=person('Avery','avery@example.test'),blair=person('Blair','blair@example.test'),cory=person('Cory','cory@example.test')

  // A signs in; then a signed-out page; then A again.
  await visit(legacy(avery));const a=await visitor()
  assert.equal(await created(),1);assert.equal(a.contact.email,avery.email);assert.equal(a.contact.verified,false)
  await say(a,'Avery asks about invoices')
  await visit(legacy());const anonymous=await visitor()
  await isolated(a);await absent('Avery asks about invoices');assert.equal(anonymous.contact.email,null)
  await say(anonymous,'Signed-out pricing question')
  await visit(legacy(avery));const returning=await visitor()
  assert.equal(returning.token,a.token,'a returning visitor gets its signed-in session back');assert.equal(await created(),0)
  await shown('Avery asks about invoices').waitFor();await isolated(anonymous);await absent('Signed-out pricing question')
  // The conversation socket delivers live replies and reconnects after it drops.
  const before=sockets.length;server.close();await until(()=>sockets.length>before,'a reconnected socket')
  const transcript=await call(`/api/conversations/${a.conversationId}/messages`)
  await call(`/api/conversations/${a.conversationId}/messages`,{status:200,body:{localId:'identity-switch-reply',content:'Your invoices are in Billing.',expectedRevision:transcript.revision,expectedLastMessageId:transcript.lastMessageId}})
  await shown('Your invoices are in Billing.').waitFor()
  // The same visitor's new details (legacy top-level fields) update its contact through the contact action.
  await page.evaluate(()=>window.h2h('update',{name:'Avery Stone',email:'avery@example.test',identifier:'avery@example.test'}))
  await until(async()=>(await call('/api/identity/widget/profile',{token:a.token})).contact.name==='Avery Stone','the renamed contact')
  assert.equal(sockets.at(-1).token,a.token)

  // B signs in after the signed-out chat: the anonymous conversation carries over, unverified; A's stays A's.
  await visit(legacy(blair));const b=await visitor()
  await isolated(a);await absent('Avery asks about invoices','Your invoices are in Billing.')
  await shown('Signed-out pricing question').waitFor()
  assert.equal(b.contact.id,anonymous.contact.id,'sign-in carries the anonymous conversation over')
  assert.equal(b.conversationId,anonymous.conversationId);assert.equal(b.contact.email,blair.email);assert.equal(b.contact.name,'Blair');assert.equal(b.contact.verified,false)
  assert.ok(await unproven(b.contact.id),'the supplied email is recorded unproven')
  await say(b,'Blair follows up')
  // A after B: B's sign-in replaced A's session, so A starts fresh and sees neither conversation.
  await visit(legacy({...avery,name:'Avery Stone'}));const fresh=await visitor()
  assert.equal(await created(),1);await isolated(a,b);assert.notEqual(fresh.contact.id,a.contact.id);assert.equal(fresh.contact.email,avery.email)
  await absent('Avery asks about invoices','Blair follows up','Signed-out pricing question')
  // Signed out again: the carried-over conversation is no longer reachable.
  await visit(legacy());const later=await visitor()
  assert.equal(await created(),1);await isolated(a,b,fresh);await absent('Signed-out pricing question','Blair follows up','Avery asks about invoices')
  await say(later,'Second signed-out visit')
  // An emulated page (no identity) after a signed-in session keeps only the anonymous session.
  await visit(legacy({...avery,name:'Avery Stone'}));assert.equal((await visitor()).token,fresh.token);await isolated(later)
  await visit(legacy());const emulated=await visitor()
  await isolated(fresh,b,a);assert.equal(emulated.token,later.token);await shown('Second signed-out visit').waitFor()
  // Switching accounts in place: the new visitor gets its own session; the old contact keeps its details.
  await visit(legacy({...avery,name:'Avery Stone'}));assert.equal((await visitor()).token,fresh.token);requests=[];sockets=[]
  await page.evaluate(contact=>window.h2h('update',{contact}),cory)
  const c=await visitor()
  await isolated(fresh);await absent('Avery asks about invoices')
  const kept=(await call('/api/identity/widget/profile',{token:fresh.token})).contact
  assert.equal(kept.email,avery.email);assert.equal(kept.name,'Avery Stone');assert.equal(c.contact.email,cory.email)

  // Email without an identifier: a letter-case change is the same visitor.
  await visit(native({name:'Dana',email:'dana@example.test'}));const dana=await visitor()
  await isolated(c,fresh,b);assert.equal(await created(),1)
  await visit(native({name:'Dana',email:'  DANA@Example.TEST '}));assert.equal((await visitor()).token,dana.token);assert.equal(await created(),0)

  // Signed identities: verified admission, kept on reload, the same contact elsewhere, never claiming the anonymous session.
  await visit(native());const signedOut=await visitor()
  const signed=identifier=>({name:identifier,email:`${identifier}@example.test`,identifier,hash:createHmac('sha256',secret).update(identifier).digest('hex')})
  await visit(native(signed('vera')));const v=await visitor()
  await isolated(signedOut,dana);assert.equal(v.contact.verified,true);assert.notEqual(v.contact.id,signedOut.contact.id)
  await say(v,'Vera asks about refunds')
  await visit(native(signed('vera')));assert.equal((await visitor()).token,v.token);assert.equal(await created(),0);await shown('Vera asks about refunds').waitFor()
  await visit(native());assert.equal((await visitor()).token,signedOut.token,'a signed identity leaves the anonymous session as it is')
  const device=(await call('/api/identity/widget/session',{token:null,body:{widgetKey,identifier:'vera',contact_hash:signed('vera').hash}}))
  assert.equal(device.contactId,v.contact.id)
  assert.ok((await call('/api/conversations',{token:device.token})).conversations.some(conversation=>conversation.id===v.conversationId),'another device reaches the same verified conversation')
  // An unverified claim of a verified contact's email gains nothing.
  const claimant=await call('/api/identity/widget/session',{token:null,body:{widgetKey,name:'Vera',email:'vera@example.test'}})
  assert.notEqual(claimant.contactId,v.contact.id)
  assert.ok(!(await call('/api/conversations',{token:claimant.token})).conversations.some(conversation=>conversation.id===v.conversationId))
  await call(`/api/conversations/${v.conversationId}/messages`,{token:claimant.token,status:404})
  await visit(native(signed('wren')));const w=await visitor()
  await isolated(v,signedOut);assert.equal(w.contact.verified,true);assert.notEqual(w.contact.id,v.contact.id);await absent('Vera asks about refunds')

  // Shutdown while mounted removes the widget and forgets this browser's sessions.
  await page.evaluate(()=>window.h2h('shutdown'))
  await page.locator('textarea[name=content]').waitFor({state:'detached'})
  await visit(native(signed('wren')));const again=await visitor()
  assert.equal(await created(),1);assert.notEqual(again.token,w.token)
  await visit(native());const afterShutdown=await visitor()
  assert.equal(await created(),1);await isolated(signedOut,w,again)
  // Shutdown queued before the script loads, during initialization and while awaiting consent.
  await visit(null,{queue:[['init',legacy(avery)],['shutdown']]})
  await page.waitForTimeout(1000);assert.equal(await page.locator('textarea[name=content]').count(),0);assert.equal(await created(),0)
  await visit(native());const queued=await visitor();assert.equal(await created(),1);await isolated(afterShutdown)
  let release;const held=new Promise(resolve=>release=resolve)
  await page.route('**/api/identity/widget/session',async route=>{await held;await route.continue().catch(()=>{})})
  await visit(null);await page.evaluate(options=>{window.h2h('init',options).catch(()=>{})},native(signed('wren')))
  await until(async()=>(await Promise.all(requests)).some(request=>request.path==='/api/identity/widget/session'),'a session request in flight')
  await page.evaluate(()=>window.h2h('shutdown'));release();await page.unroute('**/api/identity/widget/session')
  await page.waitForTimeout(1000);assert.equal(sockets.length,0);assert.equal(await page.locator('textarea[name=content]').count(),0)
  await visit(native());const interrupted=await visitor();assert.equal(await created(),1);await isolated(queued)
  await visit(null);await page.evaluate(options=>window.h2h('init',{...options,settings:{...options.settings,await_consent:true}}),native())
  await page.evaluate(()=>window.h2h('shutdown'))
  assert.match(await page.evaluate(()=>{try{window.h2h('consent',{provided:true});return 'started'}catch(error){return error.message}}),/Initialize HappyToHelp/)
  await page.waitForTimeout(500);assert.equal(await created(),0);assert.equal(sockets.length,0)
  // The alternate build's hasContext API shuts down the same way.
  await visit(native(),{global:'hasContext'});const alternate=await visitor({ui:false})
  assert.equal(await created(),1,'shutdown while awaiting consent forgot the anonymous session');await isolated(interrupted)
  await page.evaluate(()=>window.hasContext('shutdown'))
  await visit(native());await visitor();assert.equal(await created(),1);await isolated(alternate,interrupted)
  assert.deepEqual(errors,[])
  console.log('PROBE IDENTITY-001 widget identity: A/B, signed-out, carry-over, return, emulated, in-place switch, case change, signed V/W, shutdown in four states through the built widget')
  passed=true
 }catch(error){await page.screenshot({path:shot('identity-switch-failure.png'),fullPage:true}).catch(()=>{});throw error}
 finally{await context.close();await runtime.close(passed);await new Promise(resolve=>site.close(resolve))}
}
