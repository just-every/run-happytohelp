import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')

// Site preview and brand images: one paid image per request id with an uncertain fence, published assets only,
// and an isolated preview of the workspace's own website that never forwards the person's credentials.
export async function previewJourney(){
 let imageCalls=0,uncertain=false,seenHeaders,privateDns=false,websiteCalls=0
 const app=await startApp({captureQueue:true,origin:'https://app.example',bindings:{OPENAI_API_KEY:'test-only',BRAND_IMAGE_MODEL:'configured-image-model',BRAND_IMAGE_SIZE:'1024x1024',BRAND_IMAGE_QUALITY:'low',APP_ORIGIN:'https://app.example',PREVIEW_ORIGIN:'https://preview.example'},outbound:async request=>{
  const host=new URL(request.url).hostname
  if(host==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:1,data:privateDns?'127.0.0.1':'93.184.216.34'}]})
  if(host==='api.openai.com'){imageCalls++;if(uncertain)return new Response('ambiguous',{status:503});assert.equal((await request.json()).model,'configured-image-model');return Response.json({data:[{b64_json:png.toString('base64'),revised_prompt:'Fixture mark'}],usage:{input_tokens:4,output_tokens:2}},{headers:{'x-request-id':'provider-fixture'}})}
  assert.equal(new URL(request.url).origin,'https://website.example');seenHeaders=request.headers;websiteCalls++
  return new Response('<html><head><title>Site</title></head><body><a href="/about">About</a><script src="https://widget.intercom.io/widget/test"></script></body></html>',{headers:{'Content-Type':'text/html'}})
 }})
 try{
  const workspace=await app.seedWorkspace('brand',{allowedOrigin:'https://website.example'}),token=workspace.tokens.owner,path=`/api/site-preview/projects/${workspace.projectId}`
  const generation=(await app.call(path+'/brand-image-generations',{token,body:{requestId:'first',prompt:'A simple letter B'},status:202})).data;await app.drainJobs()
  const ready=await app.first('SELECT * FROM brand_generations WHERE id=?',generation.id);assert.equal(ready.state,'ready');assert.equal(imageCalls,1)
  assert.equal((await app.request('/api/site-preview/assets/'+ready.asset_id)).status,401,'an unpublished asset is private')
  assert.equal((await app.call(path+`/brand-assets/${ready.asset_id}/publish`,{token,method:'PUT',body:{}})).status,200);assert.equal((await app.request('/api/site-preview/assets/'+ready.asset_id)).status,200)
  // The same request id never pays twice; an ambiguous provider answer is uncertain and holds later requests.
  await app.call(path+'/brand-image-generations',{token,body:{requestId:'first',prompt:'A simple letter B'}});await app.drainJobs();assert.equal(imageCalls,1)
  uncertain=true;const second=(await app.call(path+'/brand-image-generations',{token,body:{requestId:'second',prompt:'Second'}})).data;await app.drainJobs()
  assert.equal((await app.first('SELECT state FROM brand_generations WHERE id=?',second.id)).state,'uncertain')
  assert.equal((await app.call(path+'/brand-image-generations',{token,body:{requestId:'third',prompt:'Third'}})).data.id,second.id,'an uncertain generation holds new requests');await app.drainJobs();assert.equal(imageCalls,2)
  // Previews: private and foreign targets are refused; the page is rewritten, sandboxed and fetched without credentials.
  assert.equal((await app.call(path+'/preview',{token,body:{url:'https://127.0.0.1'}})).status,400);assert.equal((await app.call(path+'/preview',{token,body:{url:'https://foreign.example'}})).status,403)
  const preview=(await app.call(path+'/preview',{token,body:{url:'https://website.example'},status:201})).data,url=new URL(preview.url)
  const html=await app.request(url.pathname+url.search,{base:url.origin,headers:{Cookie:'private-secret',Authorization:'Bearer private-secret'}});assert.equal(html.status,200)
  const text=await html.text();assert.match(text,/HappyToHelp Preview/);assert.ok(text.includes(preview.url+'about'));assert.match(text,/preview_token/);assert.match(text,/data:,/)
  assert.equal(seenHeaders.get('Authorization'),null);assert.equal(seenHeaders.get('Cookie'),null);assert.match(html.headers.get('Content-Security-Policy'),/sandbox/)
  assert.equal((await app.request(url.pathname+url.search,{base:app.origin})).status,404,'the app origin never serves the preview grant')
  privateDns=true;const fetched=websiteCalls
  assert.equal((await app.request(url.pathname,{base:url.origin})).status,400,'private DNS answers are refused before fetching the website')
  assert.equal(websiteCalls,fetched);privateDns=false
  // The preview grant opens a widget session, and stops with a public demo flag or lost membership.
  const previewToken=url.pathname.split('/')[3],session=()=>app.request('/api/identity/widget/session',{body:{widgetKey:workspace.widgetKey,previewToken},headers:{Origin:'https://preview.example'}})
  assert.equal((await session()).status,201)
  const grant=await app.first('SELECT expires_at FROM preview_grants')
  await app.db.prepare('UPDATE preview_grants SET expires_at=?').bind(Date.now()-1).run()
  assert.equal((await app.request(url.pathname,{base:url.origin})).status,403,'the page grant expires')
  assert.equal((await session()).status,403,'the expired grant cannot create a widget session')
  await app.db.prepare('UPDATE preview_grants SET expires_at=?').bind(grant.expires_at).run()
  await app.db.prepare('UPDATE preview_grants SET public_demo=1').run();assert.equal((await app.request(url.pathname,{base:url.origin})).status,403);assert.equal((await session()).status,403)
  await app.db.prepare('UPDATE preview_grants SET public_demo=0').run();await app.db.prepare('DELETE FROM memberships WHERE project_id=?').bind(workspace.projectId).run();assert.equal((await app.request(url.pathname,{base:url.origin})).status,403)
 }finally{await app.close()}
}
