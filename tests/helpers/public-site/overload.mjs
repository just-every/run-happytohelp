import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'

/** The Worker entry's public doors under D1's overload, at every D1 call position a request makes (counted on a
 * calm run): a read refused once or twice is retried to the calm answer, a read refused throughout and a write
 * refused once answer 503 with Retry-After and a JSON error, never 500, and a write is never re-run. */
export async function publicSiteOverloadProof(){
 const host='help.example',app=await startApp({bindings:{PUBLIC_HELP_HOSTS:JSON.stringify({[host]:'busy-help'})}})
 try{
  const w=await app.seedWorkspace('public-busy'),p=w.projectId
  const knowledge=(path,body)=>app.ok(`/api/knowledge/${p}/${path}`,{token:w.tokens.owner,body})
  await knowledge('categories',{title:'Public guides'})
  await knowledge('articles',{slug:'busy-guide',title:'Busy guide',summary:'busy guide',content:'Instructions.',status:'published'})
  await app.db.prepare("INSERT INTO public_project_aliases(slug,project_id) VALUES('busy-help',?)").bind(p).run()
  const door=(path,{headers={},...options}={})=>app.call(path,{...options,headers:{'x-test-door':'public',...headers}})
  const fault=(at,overloads)=>({'x-test-fault':'d1-overloaded','x-test-statement-at':String(at),...(overloads?{'x-test-overloads':String(overloads)}:{})})
  const positions=async(path,options={})=>{const calm=await door(path,{...options,headers:{'x-test-meter-d1':'1'}}),count=Number(calm.headers.get('x-test-d1-statements'));assert.ok(count>0,path+' reads D1');return {calm,count}}
  const busy=(answer,label)=>{
   assert.equal(answer.status,503,label+' '+JSON.stringify(answer.data).slice(0,300));assert.equal(typeof answer.data.error,'string',label)
   const wait=Number(answer.headers.get('retry-after'));assert.ok(Number.isInteger(wait)&&wait>=1&&wait<=30,label+' Retry-After is whole seconds within D1\'s window')
  }
  // An article view records its own view event, linked from the page as the request form's read receipt.
  const stable=data=>typeof data==='string'?data.replace(/afterReading=[0-9a-f-]{36}/g,'afterReading=<view event>'):data
  const reads=[`/help/${p}`,`/help/busy-help/busy-guide`,'/busy-help',`/help/${p}/requests`,`/portal/${p}`].map(path=>({path})).concat([{path:'/',base:`https://${host}`},{path:'/busy-guide',base:`https://${host}`}])
  const proven=[]
  for(const {path,base} of reads){
   const label=(base??'')+path,{calm,count}=await positions(path,{base})
   assert.ok(calm.status<500,label+' answers when calm')
   await Promise.all(Array.from({length:count},(_,index)=>index+1).map(async at=>{
    const passing=await door(path,{base,headers:fault(at,2)})
    assert.equal(passing.status,calm.status,`${label} at ${at}`);assert.deepEqual(stable(passing.data),stable(calm.data),`${label} answers the same after a passing overload at ${at}`)
    busy(await door(path,{base,headers:fault(at)}),`${label} at ${at}`)
   }))
   proven.push(`${label}:${count}`)
  }
  // The alias write: refused once at any position, it answers 503, runs only the statements before it, and writes nothing.
  const alias=`/api/public-site/projects/${p}/alias`,write=slug=>({method:'PUT',token:w.tokens.owner,body:{slug}})
  const {calm,count}=await positions(alias,write('busy-calm'))
  assert.equal(calm.status,200,JSON.stringify(calm.data))
  await Promise.all(Array.from({length:count},(_,index)=>index+1).map(async at=>{
   const slug=`busy-alias-${at}`,refused=await door(alias,{...write(slug),headers:{...fault(at,1),'x-test-meter-d1':'1'}})
   busy(refused,`${alias} at ${at}`)
   assert.equal(Number(refused.headers.get('x-test-d1-statements')),at-1,`${alias} at ${at} is not re-run`)
   assert.equal(await app.first('SELECT slug FROM public_project_aliases WHERE slug=?',slug),null,`${alias} at ${at} writes nothing`)
  }))
  proven.push(`PUT ${alias}:${count}`)
  proven.push(...await browserBusyProof({app,p,door,fault,positions,reads}))
  console.log('PUBLIC_PROOF overload positions '+proven.join(' '))
 }finally{await app.close()}
}

/** Browsers get a busy page, every other caller keeps the JSON: at every D1 position of every public read, a page load
 * (Accept: text/html) answers the HTML busy page that loads itself again after Retry-After, while Accept: application/json,
 * Accept: * / *, no Accept (above) and a script's fetch of HTML keep the JSON. A native form post refused at any position
 * answers its form again (typed and hidden fields, the chosen button, escaped, no refresh), never re-run; JSON callers keep JSON. */
async function browserBusyProof({app,p,door,fault,positions,reads}){
 const json=(answer,label)=>{assert.equal(answer.status,503,label);assert.match(answer.headers.get('content-type'),/^application\/json/,label);assert.equal(typeof answer.data.error,'string',label)}
 const page=(answer,label)=>{
  assert.equal(answer.status,503,label);assert.match(answer.headers.get('content-type'),/^text\/html;\s*charset=utf-8/i,label)
  const wait=Number(answer.headers.get('retry-after'));assert.ok(Number.isInteger(wait)&&wait>=1&&wait<=30,label+' Retry-After')
  assert.match(answer.headers.get('cache-control'),/no-store/,label);assert.match(answer.headers.get('x-content-type-options')||'',/nosniff/,label);assert.match(answer.headers.get('x-robots-tag')||'',/noindex/,label)
  assert.equal(typeof answer.data,'string',label);assert.ok(answer.data.includes('<!doctype html>'),label+' is a page')
  return wait
 }
 // Every dispatched request carries fetch's own Sec-Fetch-Mode: cors, as the Help Center's script fetch does; Miniflare's
 // MF-Sec-Fetch-Mode stands in for a browser's navigation.
 const html='text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',navigate={'MF-Sec-Fetch-Mode':'navigate'},proven=[]
 for(const {path,base} of reads){
  const label=(base??'')+path,{count}=await positions(path,{base})
  await Promise.all(Array.from({length:count},(_,index)=>index+1).map(async at=>{
   const busy=await door(path,{base,headers:{...fault(at),Accept:html,...navigate}}),wait=page(busy,`${label} page at ${at}`)
   assert.ok(busy.data.includes(`<meta http-equiv="refresh" content="${wait}">`),`${label} at ${at} loads itself again after Retry-After`)
   for(const accept of ['application/json','*/*'])json(await door(path,{base,headers:{...fault(at),Accept:accept}}),`${label} Accept ${accept} at ${at}`)
   json(await door(path,{base,headers:{...fault(at),Accept:'text/html'}}),`${label} fetched by a script at ${at}`)
  }))
  proven.push(`html:${label}:${count}`)
 }
 const head=await door(`/help/${p}`,{method:'HEAD',headers:{...fault(1),Accept:html,...navigate}})
 assert.equal(head.status,503);assert.match(head.headers.get('content-type'),/^text\/html/)
 // "Was this helpful?" posted natively: refused at each position, the page carries the form back and nothing is re-run or recorded
 // (each post its own visitor, so the per-visitor feedback limit never answers first).
 const action=`/api/knowledge/public/${p}/articles/busy-guide/helpful`,typed='Tried twice "<b>bold</b>" & left',returnTo=`/help/${p}/busy-guide`
 const form=(headers,body={locale:'en',returnTo,comment:typed,helpful:'false'})=>app.call(action,{method:'POST',raw:true,body:new URLSearchParams(body).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:app.origin,...headers}})
 const votes=async()=>(await app.first('SELECT count(*) AS n FROM knowledge_feedback WHERE project_id=?',p)).n
 const calm=await form({Accept:html,'User-Agent':'busy-calm','x-test-meter-d1':'1'}),count=Number(calm.headers.get('x-test-d1-statements'))
 assert.equal(calm.status,303,'a calm native post lands on the article');assert.equal(await votes(),1)
 await Promise.all(Array.from({length:count},(_,index)=>index+1).map(async at=>{
  const refused=await form({...fault(at,1),Accept:html,...navigate,'User-Agent':`busy-page-${at}`,'x-test-meter-d1':'1'}),label=`${action} at ${at}`
  page(refused,label);assert.equal(Number(refused.headers.get('x-test-d1-statements')),at-1,label+' is not re-run')
  assert.match(refused.headers.get('referrer-policy')||'',/^same-origin$/,label+' keeps the Origin a re-post needs')
  assert.ok(!refused.data.includes('http-equiv="refresh"'),label+' never posts by itself')
  assert.ok(refused.data.includes(`<form class="help-center-busy-form" method="post" action="${action}">`),label+' posts to the same action')
  assert.ok(refused.data.includes('>\nTried twice &quot;&lt;b&gt;bold&lt;/b&gt;&quot; &amp; left</textarea>'),label+' keeps the typed comment, escaped')
  assert.ok(!refused.data.includes('<b>bold</b>'),label+' escapes what was typed')
  for(const [name,value] of [['locale','en'],['returnTo',returnTo],['helpful','false']])assert.ok(refused.data.includes(`<input type="hidden" name="${name}" value="${value}">`),`${label} carries ${name}`)
  assert.match(refused.data,/Was this helpful\? <strong>No<\/strong>/,label+' keeps the chosen answer')
  json(await form({...fault(at,1),Accept:'*/*','User-Agent':`busy-json-${at}`}),`${action} Accept */* at ${at}`)
 }))
 json(await app.call(action,{method:'POST',body:{helpful:false},headers:{...fault(1,1),Accept:html,Origin:app.origin}}),`${action} posted as JSON`)
 assert.equal(await votes(),1,'no refused post recorded a vote')
 proven.push(`html:POST ${action}:${count}`)
 return proven
}

/** A read's side effects happen once (src/platform/read-effects.ts), at every D1 call position a read makes (counted
 * on a calm run): refused twice, an article view records one view event and one read receipt and a search one search
 * event, and the page links the rows written; answered busy, it records nothing. Both sign-in links sign in when
 * refused twice at any position, and a link answered busy stays unspent. */
export async function readEffectsOnceProof(){
 const host='once.example',mail=[]
 const app=await startApp({bindings:{PUBLIC_HELP_HOSTS:JSON.stringify({[host]:'once-help'}),APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-provider-key',EMAIL_FROM:'support@example.com'},outbound:async request=>{
  if(request.url==='https://api.resend.com/emails'){mail.push(await request.json());return Response.json({id:'message-'+mail.length})}
  throw new Error('Unexpected provider request '+request.url)
 }})
 try{
  const w=await app.seedWorkspace('read-once'),p=w.projectId,owner={token:w.tokens.owner}
  await app.db.prepare("INSERT INTO email_settings VALUES(?,'Once Support','support@example.com','help@example.com',1,1)").bind(p).run()
  await app.ok(`/api/knowledge/${p}/categories`,{...owner,body:{title:'Guides'}})
  await app.ok(`/api/knowledge/${p}/articles`,{...owner,body:{slug:'once-guide',title:'Once guide',summary:'once guide',content:'Instructions.',status:'published'}})
  // A published form puts the read receipt's request link on the article page.
  await app.ok(`/api/forms/projects/${p}/forms`,{...owner,body:{title:'Ask about a guide',locale:'en',enabled:true,fields:[]}})
  await app.db.prepare("INSERT INTO public_project_aliases(slug,project_id) VALUES('once-help',?)").bind(p).run()
  const fault=(at,overloads)=>({'x-test-fault':'d1-overloaded','x-test-statement-at':String(at),...(overloads?{'x-test-overloads':String(overloads)}:{})})
  const positions=count=>Array.from({length:count},(_,index)=>index+1)
  // Each request is its own visitor (an anonymous visitor is the project, address and User-Agent).
  const address='198.51.100.7',visitor=agent=>createHash('sha256').update(`${p}:${address}:${agent}`).digest('hex')
  const events=async(kind,agent)=>Number((await app.first('SELECT count(*) n FROM knowledge_events WHERE project_id=? AND kind=? AND visitor_hash=?',p,kind,visitor(agent))).n)
  const receipts=async()=>Number((await app.first('SELECT count(*) n FROM knowledge_read_receipts WHERE project_id=?',p)).n)
  const pages=[{kind:'view',path:'/help/once-help/once-guide'},{kind:'view',path:'/once-guide',base:`https://${host}`},{kind:'search',path:'/help/once-help/search?keyword=guide'},{kind:'search',path:'/search?keyword=guide',base:`https://${host}`},{kind:'search',path:`/api/knowledge/public/${p}/search?q=guide`,api:true}]
  const proven=[]
  for(const {kind,path,base,api} of pages){
   const label=(base??'')+path,read=(agent,headers={})=>app.call(path,{base,headers:{...(api?{}:{'x-test-door':'public'}),'CF-Connecting-IP':address,'User-Agent':agent,...headers}})
   const calm=await read(label+' calm',{'x-test-meter-d1':'1'}),count=Number(calm.headers.get('x-test-d1-statements'))
   assert.equal(calm.status,200,label);assert.equal(await events(kind,label+' calm'),1,label+' records once when calm')
   const before=await receipts()
   await Promise.all(positions(count).map(async at=>{
    const passing=`${label} passing ${at}`,busy=`${label} busy ${at}`,page=await read(passing,fault(at,2))
    assert.equal(page.status,200,passing)
    assert.equal(await events(kind,passing),1,`${passing} records one ${kind} event`)
    if(kind==='view'){
     const view=page.data.match(/afterReading=([0-9a-f-]{36})/)?.[1],token=page.data.match(/requests\?read=([0-9a-f-]{72})/)?.[1]
     assert.ok(view&&await app.first('SELECT 1 FROM knowledge_events WHERE id=? AND visitor_hash=?',view,visitor(passing)),`${passing} links its own view event`)
     assert.ok(token&&await app.first('SELECT 1 FROM knowledge_read_receipts WHERE token=?',token),`${passing} links its own read receipt`)
    }
    const refused=await read(busy,fault(at))
    assert.equal(refused.status,503,busy)
    assert.equal(await events(kind,busy),0,`${busy} records nothing`)
   }))
   if(kind==='view')assert.equal(await receipts()-before,count,label+' writes one read receipt per answered view and none for a busy one')
   proven.push(`${label}:${count}`)
  }
  // Sign-in links, issued by the real request doors through the mail provider edge.
  // Each link is asked for from its own address, within the request doors' per-address limits.
  const link=async(kind,email,at=0)=>{
   const offset=mail.length
   await app.call(kind==='help'?`/api/knowledge/public/${p}/access/request`:`/api/portal/${p}/access/request`,{body:{email},headers:{Origin:app.origin,'CF-Connecting-IP':`203.0.113.${at}`},status:202})
   const sent=mail.slice(offset).find(message=>[].concat(message.to).includes(email));assert.ok(sent,`${kind} sign-in mail for ${email}`)
   const url=new URL(sent.text.match(/https:\/\/app\.example\/api\/\S+/)[0]);return url.pathname+url.search
  }
  const audits=async action=>Number((await app.first('SELECT count(*) n FROM audit_events WHERE project_id=? AND action=?',p,action)).n)
  for(const [kind,cookie,action] of [['help','h2h_help','knowledge.access.verified'],['portal','h2h_portal','portal.access.verified']]){
   const calm=await app.call(await link(kind,`${kind}-calm@once.example`),{headers:{'x-test-meter-d1':'1'}}),count=Number(calm.headers.get('x-test-d1-statements'))
   assert.equal(calm.status,303,kind+' link signs in when calm')
   const before=await audits(action)
   await Promise.all(positions(count).map(async at=>{
    const path=await link(kind,`${kind}-${at}@once.example`,at),label=`${kind} sign-in link at ${at}`
    const busy=await app.call(path,{headers:fault(at)})
    assert.equal(busy.status,503,label+' answers busy');assert.equal(busy.headers.get('set-cookie'),null,label)
    const signed=await app.call(path,{headers:fault(at,2)})
    assert.equal(signed.status,303,`${label} signs in after two refusals and a busy answer: ${JSON.stringify(signed.data)}`)
    const session=signed.headers.get('set-cookie')?.split(';')[0]??'';assert.match(session,new RegExp(`^${cookie}=`),label)
    if(kind==='help')assert.ok(await app.first('SELECT 1 FROM knowledge_help_sessions WHERE token_hash=?',createHash('sha256').update(session.slice(cookie.length+1)).digest('hex')),label+' holds a live help session')
    else assert.equal((await app.call(`/api/portal/${p}/tickets`,{headers:{Cookie:session,Origin:app.origin}})).status,200,label+' opens the portal')
   }))
   assert.equal(await audits(action)-before,count,`each ${kind} link is audited once`)
   proven.push(`${kind}-verify:${count}`)
  }
  console.log('PUBLIC_PROOF read effects once '+proven.join(' '))
 }finally{await app.close()}
}
